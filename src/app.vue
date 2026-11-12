<template>
  <div class="demo">
    <div class="actions">
      <button type="button" @click="show = !show">
        {{ show ? 'Unmount' : 'Mount' }} viewer
      </button>
      <button type="button" @click="pdf = pdf ? undefined : '/sample.pdf'">
        {{ pdf ? 'Clear' : 'Load' }} pdf
      </button>
      <button type="button" @click="loadArrayBuffer">
        Load as ArrayBuffer
      </button>
      <button type="button" @click="trimToolbar = !trimToolbar">
        {{ trimToolbar ? 'Full' : 'Trimmed' }} toolbar
      </button>
      <button type="button" @click="theme = nextTheme[theme ?? 'auto']">
        Theme: {{ theme ?? 'auto' }}
      </button>
      <button type="button" @click="toggleDirection">
        Toggle page direction
      </button>
    </div>
    <pdf-viewer
      v-if="show"
      class="viewer"
      :pdf="pdf"
      :config="trimToolbar ? trimmedConfig : undefined"
      :theme="theme"
      :page-number="2"
      file-name="Custom fileName.pdf"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import PdfViewer from '@/components/pdf-viewer.vue';
import { Theme, ToolbarConfig } from '@/types';

const show = ref(true);
const pdf = ref<string | ArrayBuffer | undefined>('/sample.pdf');
const trimToolbar = ref(false);
const theme = ref<Theme>();

const trimmedConfig: ToolbarConfig = {
  sidebar: false,
  secondaryToolbar: { documentProperties: false, scrollWrapped: false },
  toolbar: {
    toolbarViewerRight: { print: false, editorInk: false, editorStamp: false },
  },
};
const nextTheme: Record<string, Theme | undefined> = {
  auto: 'light',
  light: 'dark',
  dark: undefined,
};

async function loadArrayBuffer() {
  pdf.value = await (await fetch('/sample.pdf')).arrayBuffer();
}

function toggleDirection() {
  const dir = document.documentElement.getAttribute('dir');
  document.documentElement.setAttribute('dir', dir === 'rtl' ? 'ltr' : 'rtl');
}
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

.demo {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.actions {
  padding: 8px;
  display: flex;
  gap: 8px;
}

.viewer {
  flex: 1;
  min-height: 0;
}
</style>
