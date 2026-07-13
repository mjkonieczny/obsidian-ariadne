import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Git worktrees live under .claude/worktrees/ and carry their own copy of
		// src/, so without this every test is collected - and reported - twice.
		exclude: ['**/node_modules/**', '**/.claude/**'],
	},
});
