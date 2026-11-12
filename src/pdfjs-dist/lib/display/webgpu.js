/* Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import "core-js/modules/es.typed-array.with.js";
const MESH_WGSL = `
struct Uniforms {
  offsetX      : f32,
  offsetY      : f32,
  scaleX       : f32,
  scaleY       : f32,
  paddedWidth  : f32,
  paddedHeight : f32,
  borderSize   : f32,
  _pad         : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VertexInput {
  @location(0) position : vec2<f32>,
  @location(1) color    : vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0)       color    : vec3<f32>,
};

@vertex
fn vs_main(in : VertexInput) -> VertexOutput {
  var out : VertexOutput;
  let cx = (in.position.x + u.offsetX) * u.scaleX;
  let cy = (in.position.y + u.offsetY) * u.scaleY;
  out.position = vec4<f32>(
    ((cx + u.borderSize) / u.paddedWidth) * 2.0 - 1.0,
    1.0 - ((cy + u.borderSize) / u.paddedHeight) * 2.0,
    0.0,
    1.0
  );
  out.color = in.color.rgb;
  return out;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;
class WebGPU {
  #initPromise = null;
  #device = null;
  #meshPipeline = null;
  #preferredFormat = null;
  async #initGPU() {
    if (!globalThis.navigator?.gpu) {
      return false;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return false;
      }
      this.#preferredFormat = navigator.gpu.getPreferredCanvasFormat();
      this.#device = await adapter.requestDevice();
      return true;
    } catch {
      return false;
    }
  }
  init() {
    return this.#initPromise ||= this.#initGPU();
  }
  get isReady() {
    return this.#device !== null;
  }
  loadMeshShader() {
    if (!this.#device || this.#meshPipeline) {
      return;
    }
    const shaderModule = this.#device.createShaderModule({
      code: MESH_WGSL
    });
    this.#meshPipeline = this.#device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: 2 * 4,
          attributes: [{
            shaderLocation: 0,
            offset: 0,
            format: "float32x2"
          }]
        }, {
          arrayStride: 4,
          attributes: [{
            shaderLocation: 1,
            offset: 0,
            format: "unorm8x4"
          }]
        }]
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{
          format: this.#preferredFormat
        }]
      },
      primitive: {
        topology: "triangle-list"
      }
    });
  }
  draw(posData, colData, vertexCount, context, backgroundColor, paddedWidth, paddedHeight, borderSize) {
    this.loadMeshShader();
    const device = this.#device;
    const {
      offsetX,
      offsetY,
      scaleX,
      scaleY
    } = context;
    const posBuffer = device.createBuffer({
      size: Math.max(posData.byteLength, 4),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    if (posData.byteLength > 0) {
      device.queue.writeBuffer(posBuffer, 0, posData);
    }
    const colBuffer = device.createBuffer({
      size: Math.max(colData.byteLength, 4),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    if (colData.byteLength > 0) {
      device.queue.writeBuffer(colBuffer, 0, colData);
    }
    const uniformBuffer = device.createBuffer({
      size: 8 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([offsetX, offsetY, scaleX, scaleY, paddedWidth, paddedHeight, borderSize, 0]));
    const bindGroup = device.createBindGroup({
      layout: this.#meshPipeline.getBindGroupLayout(0),
      entries: [{
        binding: 0,
        resource: {
          buffer: uniformBuffer
        }
      }]
    });
    const offscreen = new OffscreenCanvas(paddedWidth, paddedHeight);
    const gpuCtx = offscreen.getContext("webgpu");
    gpuCtx.configure({
      device,
      format: this.#preferredFormat,
      alphaMode: backgroundColor ? "opaque" : "premultiplied"
    });
    const clearValue = backgroundColor ? {
      r: backgroundColor[0] / 255,
      g: backgroundColor[1] / 255,
      b: backgroundColor[2] / 255,
      a: 1
    } : {
      r: 0,
      g: 0,
      b: 0,
      a: 0
    };
    const commandEncoder = device.createCommandEncoder();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: gpuCtx.getCurrentTexture().createView(),
        clearValue,
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    if (vertexCount > 0) {
      renderPass.setPipeline(this.#meshPipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.setVertexBuffer(0, posBuffer);
      renderPass.setVertexBuffer(1, colBuffer);
      renderPass.draw(vertexCount);
    }
    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
    posBuffer.destroy();
    colBuffer.destroy();
    uniformBuffer.destroy();
    return offscreen.transferToImageBitmap();
  }
}
const _webGPU = new WebGPU();
function initGPU() {
  return _webGPU.init();
}
function isGPUReady() {
  return _webGPU.isReady;
}
function loadMeshShader() {
  _webGPU.loadMeshShader();
}
function drawMeshWithGPU(posData, colData, vertexCount, context, backgroundColor, paddedWidth, paddedHeight, borderSize) {
  return _webGPU.draw(posData, colData, vertexCount, context, backgroundColor, paddedWidth, paddedHeight, borderSize);
}
export { drawMeshWithGPU, initGPU, isGPUReady, loadMeshShader };