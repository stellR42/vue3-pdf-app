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
import { PasswordException, PasswordResponses, stripPath, warn } from "../shared/util.js";
import { BaseStream } from "./base_stream.js";
import { Dict } from "./primitives.js";
import { stringToPDFString } from "./string_utils.js";
class FileSpec {
  constructor(root) {
    if (!(root instanceof Dict)) {
      return;
    }
    this.root = root;
    if (root.has("RF")) {
      warn("Related file specifications are not supported");
    }
  }
  get filename() {
    const item = FileSpec.pickPlatformItem(this.root);
    if (item && typeof item === "string") {
      return stringToPDFString(item, true).replaceAll("\\\\", "\\").replaceAll("\\/", "/").replaceAll("\\", "/");
    }
    return "";
  }
  get description() {
    const desc = this.root?.get("Desc");
    return desc && typeof desc === "string" ? stringToPDFString(desc) : "";
  }
  get serializable() {
    const {
      filename,
      description
    } = this;
    return {
      rawFilename: filename,
      filename: stripPath(filename) || "unnamed",
      description
    };
  }
  static pickPlatformItem(dict, raw = false) {
    if (dict instanceof Dict) {
      for (const key of ["UF", "F", "Unix", "Mac", "DOS"]) {
        if (dict.has(key)) {
          return raw ? dict.getRaw(key) : dict.get(key);
        }
      }
    }
    return null;
  }
  static hasEmbeddedFile(fileSpecDict) {
    return this.pickPlatformItem(fileSpecDict.get("EF")) instanceof BaseStream;
  }
  static readContent(dict) {
    if (!(dict instanceof Dict)) {
      return null;
    }
    const ef = this.pickPlatformItem(dict.get("EF"));
    if (!(ef instanceof BaseStream)) {
      warn("Embedded file specification points to non-existing/invalid content");
      return null;
    }
    return this.readStreamContent(ef);
  }
  static readStreamContent(stream) {
    const encrypt = stream.dict?.xref?.encrypt;
    if (encrypt?.encryptionKey === null) {
      throw new PasswordException("No password given", PasswordResponses.NEED_PASSWORD);
    }
    return stream.getBytes();
  }
}
export { FileSpec };