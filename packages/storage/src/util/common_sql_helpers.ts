//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

export function validateTableAndSchema(
  table: string,
  primaryKeySchema: Record<string, any>,
  valueSchema: Record<string, any>
): void {
  // check for dumb things
  // Check for invalid characters in table name
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(table)) {
    throw new Error(
      `Invalid table name: ${table}. Must start with letter/underscore and contain only alphanumeric/underscore characters`
    );
  }

  // Check for invalid characters in schema keys
  const validateSchemaKeys = (schema: Record<string, any>) => {
    Object.keys(schema).forEach((key) => {
      if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) {
        throw new Error(
          `Invalid schema key: ${key}. Must start with letter/underscore and contain only alphanumeric/underscore characters`
        );
      }
    });
  };
  validateSchemaKeys(primaryKeySchema);
  validateSchemaKeys(valueSchema);

  // Check for duplicate keys between schemas
  const primaryKeys = new Set(Object.keys(primaryKeySchema));
  const valueKeys = Object.keys(valueSchema);
  const duplicates = valueKeys.filter((key) => primaryKeys.has(key));
  if (duplicates.length > 0) {
    throw new Error(`Duplicate keys found in schemas: ${duplicates.join(", ")}`);
  }
}
