#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import App from './app.js';
import { initShutdownHandler } from './lib/shutdown.js';


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

render(<App name={cli.flags.name} />);

