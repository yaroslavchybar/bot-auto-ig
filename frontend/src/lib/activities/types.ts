/**
 * Activity Types
 * 
 * This file defines all the types used for workflow activities.
 * Each activity node in a workflow uses these types.
 */

// Which category an activity belongs to
export type ActivityCategory = 'browsing' | 'engagement' | 'messaging' | 'stories' | 'control';

// Types of inputs an activity can have
export type InputType = 'string' | 'number' | 'boolean' | 'select' | 'template' | 'profile' | 'range';

// Options for dropdown/select inputs
export interface ActivityInputOption {
	label: string;
	value: string;
}

// Definition of a single input field
export interface ActivityInput {
	name: string;           // Internal field name (used in code)
	type: InputType;        // What kind of input
	label: string;          // Display label
	required?: boolean;     // Is this required?
	default?: unknown;      // Default value
	options?: ActivityInputOption[];  // For select type
	min?: number;           // For number/range
	max?: number;           // For number/range
	step?: number;          // For number/range
	unit?: string;          // Display unit (e.g., 'min', 'sec', '%')
	placeholder?: string;   // Placeholder text
	helpText?: string;      // Help text shown below
	group?: string;         // Group related inputs together
}

// Possible output handles from an activity
export type ActivityOutput = 'success' | 'failure' | 'next' | 'loop' | 'done' | 'true' | 'false' | 'path_a' | 'path_b' | 'path_c';

// Full definition of an activity
export interface ActivityDefinition {
	id: string;             // Unique ID (e.g., 'browse_feed')
	name: string;           // Display name (e.g., 'Browse Feed')
	description: string;    // What this activity does
	category: ActivityCategory;
	icon: string;           // Lucide icon name
	color: string;          // Hex color for the node
	inputs: ActivityInput[];     // Configuration inputs
	outputs: ActivityOutput[];   // Output handles for connections
	pythonHandler: string;       // Python module that runs this
}
