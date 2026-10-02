import './client.css';
import { createApp } from 'vue';
import apps from 'virtual:db3/apps';

const component = await apps.find(app => app.id === 'social').load();
createApp(component.default, { path: '' }).mount('#app');
