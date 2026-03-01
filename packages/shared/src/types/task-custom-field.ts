/**
 * Task custom field types for dynamic metadata on tasks.
 *
 * Based on TaskCustomFieldDefinition, BoardTaskCustomField, TaskCustomFieldValue
 * models and corresponding Pydantic schemas.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Supported custom field data types. */
export type CustomFieldType =
  | 'text'
  | 'text_long'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'date_time'
  | 'url'
  | 'json';

/** UI visibility mode controlling when the field is rendered. */
export type CustomFieldUiVisibility = 'always' | 'if_set' | 'hidden';

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

/** Reusable custom field definition for task metadata. */
export interface CustomFieldDefinition {
  id: string;
  organizationId: string;
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  uiVisibility: CustomFieldUiVisibility;
  validationRegex: string | null;
  description: string | null;
  required: boolean;
  defaultValue: unknown | null;
  /** Board IDs where this definition is currently bound. */
  boardIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Board-level binding of a custom field definition. */
export interface BoardTaskCustomField {
  id: string;
  boardId: string;
  taskCustomFieldDefinitionId: string;
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  uiVisibility: CustomFieldUiVisibility;
  validationRegex: string | null;
  description: string | null;
  required: boolean;
  defaultValue: unknown | null;
  createdAt: string;
}

/** Stored task-level value for a bound custom field. */
export interface CustomFieldValue {
  id: string;
  taskId: string;
  taskCustomFieldDefinitionId: string;
  value: unknown | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

/** Payload for creating a task custom field definition. */
export interface CreateCustomFieldDefinitionRequest {
  fieldKey: string;
  label?: string | null;
  fieldType?: CustomFieldType;
  uiVisibility?: CustomFieldUiVisibility;
  validationRegex?: string | null;
  description?: string | null;
  required?: boolean;
  defaultValue?: unknown | null;
  /** At least one board must be specified. */
  boardIds: string[];
}

/** Payload for editing an existing task custom field definition. */
export interface UpdateCustomFieldDefinitionRequest {
  label?: string;
  fieldType?: CustomFieldType;
  uiVisibility?: CustomFieldUiVisibility;
  validationRegex?: string | null;
  description?: string | null;
  required?: boolean;
  defaultValue?: unknown | null;
  boardIds?: string[];
}

/** Payload for binding a definition to a board. */
export interface CreateBoardTaskCustomFieldRequest {
  taskCustomFieldDefinitionId: string;
}

/** Map of field keys to their values, used when setting custom fields on a task. */
export type CustomFieldValues = Record<string, unknown | null>;

/** Payload for setting all custom-field values on a task at once. */
export interface SetCustomFieldValuesRequest {
  customFieldValues: CustomFieldValues;
}
