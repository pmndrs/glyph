import './styles.css';

import { createApp } from 'vue';

import App from './App.vue';

const app = createApp(App);
app.mount('#app');

import.meta.hot?.dispose(() => app.unmount());
