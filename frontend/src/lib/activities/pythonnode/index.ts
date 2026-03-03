import type { ActivityDefinition } from '../types';

export const pythonScript: ActivityDefinition = {
    id: 'python_script',
    name: 'Python Script',
    description: 'Execute custom Python code',
    category: 'python',
    icon: 'TerminalSquare',
    color: '#eab308',

    inputs: [
        {
            name: 'code',
            type: 'code',
            label: 'Python Code',
            required: true,
            default: 'log("Hello from Python node!")\n',
            helpText: 'Available variables: page, account, log, time, random. The execution happens synchronously.',
        },
    ],

    outputs: ['success', 'failure'],
    pythonHandler: '__builtin__.python_script',
};

export const pythonActivities = [pythonScript];
