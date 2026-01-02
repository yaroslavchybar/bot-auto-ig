#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import App from './app.js';
import { initShutdownHandler } from './lib/shutdown.js';
import { profileManager } from './lib/profiles.js';


const cli = meow(
	`
	Usage
	  $ anti-cli

	Options
		--name  Your name

	Examples
	  $ anti-cli --name=Jane
	  Hello, Jane
`,
	{
		importMeta: import.meta,
		flags: {
			name: {
				type: 'string',
			},
		},
	},
);

initShutdownHandler();

// Sync local profiles to database on app launch
(async () => {
	try {
		const result = await profileManager.syncLocalProfilesToDb();
		if (result.created > 0) {
			console.log(`Synced ${result.created} local profile(s) to database.`);
		}
	} catch (e) {
		// Silently ignore sync errors - DB may not be available
	}
	render(<App name={cli.flags.name} />);
})();


