import type pg from 'pg';
import {
  validateRelationData,
  validateRecordLinks,
  type DatasetRelation,
  type DatasetRow,
} from '@modelboard/shared';
export function relationFromSql(row: any): DatasetRelation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceDatasetId: row.source_dataset_id,
    sourceColumnId: row.source_column_id ?? '__row__',
    targetDatasetId: row.target_dataset_id,
    targetColumnId: row.target_column_id ?? '__row__',
    relationType: row.relation_type,
    cardinality: row.cardinality,
    matchMode: row.properties?.matchMode ?? 'FIELDS',
    links: row.links,
    name: row.properties?.name ?? '',
    enforceIntegrity:
      row.relation_type === 'FOREIGN_KEY' ||
      Boolean(row.properties?.enforceIntegrity),
  };
}
export async function validateSqlRelation(
  client: Pick<pg.PoolClient, 'query'>,
  relation: DatasetRelation,
  candidate?: { datasetId: string; rows: DatasetRow[] },
) {
  const load = async (id: string) =>
    candidate?.datasetId === id
      ? candidate.rows
      : (
          await client.query(
            'SELECT id,ordinal,values FROM dataset_rows WHERE dataset_id=$1 ORDER BY ordinal,id',
            [id],
          )
        ).rows;
  const [source, target] = await Promise.all([
    load(relation.sourceDatasetId),
    load(relation.targetDatasetId),
  ]);
  if (relation.matchMode === 'ROW_LINKS') {
    if (relation.links === undefined)
      relation.links = (
        await client.query(
          'SELECT source_row_id AS "sourceRowId",target_row_id AS "targetRowId" FROM dataset_relation_links WHERE relation_id=$1',
          [relation.id],
        )
      ).rows;
    return validateRecordLinks(relation, source, target);
  }
  return validateRelationData(relation, source, target);
}
/** Called under the workspace transaction lock before persisting a Dataset. */
export async function assertDatasetRelations(
  client: Pick<pg.PoolClient, 'query'>,
  datasetId: string,
  rows: DatasetRow[],
) {
  const relations = await client.query(
    'SELECT * FROM dataset_relations WHERE deleted_at IS NULL AND (source_dataset_id=$1 OR target_dataset_id=$1)',
    [datasetId],
  );
  for (const row of relations.rows) {
    const relation = relationFromSql(row);
    if (!relation.enforceIntegrity && relation.matchMode !== 'ROW_LINKS')
      continue;
    const result = await validateSqlRelation(client, relation, {
      datasetId,
      rows,
    });
    if (!result.valid)
      throw new Error(
        `Связь «${relation.name || relation.relationType}»: ${result.issues.join('; ')}`,
      );
  }
}
