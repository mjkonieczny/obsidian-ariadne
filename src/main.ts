import { Plugin } from 'obsidian';
import { registerViews } from './registerViews';

export default class AriadnePlugin extends Plugin {
	async onload() {
		registerViews(this);
	}

	onunload() {}
}
