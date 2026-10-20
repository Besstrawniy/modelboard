import { datasetRecordLabel } from '../lib/datasetRecordLabel';
import { relatedRows } from '@modelboard/shared';
import {
  PanelTopOpen,
  ArrowLeftRight,
  Database,
  GitBranchPlus,
  LayoutList,
  Link2,
  Network,
  XCircle,
} from 'lucide-react';
import type {
  DatasetRelation,
  DatasetRow,
  DatasetSnapshot,
  DeviceKind,
  VisualTemplateRef,
} from '@modelboard/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { useBoardActions } from './BoardContext';

function compactRowLabel(row: DatasetRow, dataset: DatasetSnapshot) {
  const parts = dataset.columns
    .slice(0, 4)
    .map((column) => ({
      name: column.name,
      value: row.values[column.id],
    }))
    .filter(
      ({ value }) =>
        value !== null && value !== undefined && String(value) !== '',
    );

  return parts.slice(0, 3);
}

function RelatedRelationSection({
  relation,
  currentDataset,
  currentRow,
  token,
  parentNodeId,
}: {
  relation: DatasetRelation;
  currentDataset: DatasetSnapshot;
  currentRow: DatasetRow;
  token: string;
  parentNodeId: string;
}) {
  const {
    readOnly,
    materializeRelated,
    createRelationView,
    hideMaterializedRelated,
    materializedRelatedCount,
    workspaceTemplates,
    openDatasetSheet,
  } = useBoardActions();
  const [materializing, setMaterializing] = useState(false);
  const [materializeMessage, setMaterializeMessage] = useState('');
  const [visualTemplateKey, setVisualTemplateKey] = useState('');
  const [relationViewBusy, setRelationViewBusy] = useState(false);
  const [visibleColumnIds,setVisibleColumnIds]=useState<string[]|null>(null);

  const currentIsSource = relation.sourceDatasetId === currentDataset.id;
  const otherDatasetId = currentIsSource
    ? relation.targetDatasetId
    : relation.sourceDatasetId;

  const localColumnId = currentIsSource
    ? relation.sourceColumnId
    : relation.targetColumnId;

  const remoteColumnId = currentIsSource
    ? relation.targetColumnId
    : relation.sourceColumnId;

  const { dataset: otherDataset, status } = useCollaborativeDataset(
    otherDatasetId,
    token,
    true,
  );

  const localColumn = currentDataset.columns.find(
    (column) => column.id === localColumnId,
  );
  const localValue = currentRow.values[localColumnId];

  const matches = useMemo(
    () =>
      otherDataset
        ? relatedRows(
            relation,
            currentDataset.id,
            currentRow,
            otherDataset.rows,
          )
        : [],
    [relation, currentDataset.id, currentRow, otherDataset],
  );

  const remoteColumn = otherDataset?.columns.find(
    (column) => column.id === remoteColumnId,
  );

  const visibleOnCanvas = materializedRelatedCount(parentNodeId, relation.id);

  const inferredKind: DeviceKind =
    /(^|[_\s-])(vm|machine|virtual)([_\s-]|$)/i.test(otherDataset?.name ?? '')
      ? 'VM'
      : /server|host/i.test(otherDataset?.name ?? '')
        ? 'SERVER'
        : /database|db|postgres|mysql|sql/i.test(otherDataset?.name ?? '')
          ? 'DATABASE'
          : /firewall|fw/i.test(otherDataset?.name ?? '')
            ? 'FIREWALL'
            : /switch/i.test(otherDataset?.name ?? '')
              ? 'SWITCH'
              : /router|gateway/i.test(otherDataset?.name ?? '')
                ? 'ROUTER'
                : 'VM';

  const effectiveTemplateKey = visualTemplateKey || `builtin:${inferredKind}`;

  const visualTemplate: VisualTemplateRef = effectiveTemplateKey.startsWith(
    'workspace:',
  )
    ? {
        source: 'WORKSPACE',
        templateId: effectiveTemplateKey.slice('workspace:'.length),
      }
    : {
        source: 'BUILTIN',
        deviceKind: effectiveTemplateKey.slice('builtin:'.length) as DeviceKind,
      };

  const showOnCanvas = async () => {
    if (!otherDataset || matches.length === 0 || readOnly) return;

    setMaterializing(true);
    setMaterializeMessage('');
    try {
      const created = await materializeRelated({
        parentNodeId,
        relation,
        dataset: otherDataset,
        rows: matches,
        visualTemplate,
      });
      setMaterializeMessage(
        created > 0
          ? `Добавлено объектов: ${created}`
          : 'Все связанные объекты уже есть на canvas.',
      );
    } catch (error) {
      setMaterializeMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setMaterializing(false);
    }
  };

  return (
    <article className="related-relation">
      <div className="related-relation__header">
        <div>
          <span className="related-relation__type">
            {relation.relationType}
          </span>
          {relation.cardinality && (
            <span className="related-relation__cardinality">
              {currentIsSource ? relation.cardinality : relation.cardinality==='1:N'?'N:1':relation.cardinality==='N:1'?'1:N':relation.cardinality}
            </span>
          )}
        </div>
        <small>{status}</small>
      </div>

      <div className="related-relation__path">
        <span>
          {currentDataset.name}
          {relation.matchMode === 'ROW_LINKS'
            ? ' · запись'
            : `.${localColumn?.name ?? localColumnId.slice(0, 8)}`}
        </span>
        <ArrowLeftRight size={12} />
        <span>
          {otherDataset?.name ?? 'Dataset'}
          {relation.matchMode === 'ROW_LINKS'
            ? ' · записи'
            : `.${remoteColumn?.name ?? remoteColumnId.slice(0, 8)}`}
        </span>
      </div>

      <div className="related-relation__value">
        {relation.matchMode === 'ROW_LINKS' ? (
          'Записи связаны напрямую. Колонки id/fk не требуются.'
        ) : (
          <>
            Значение связи: <code>{String(localValue ?? 'NULL')}</code>
          </>
        )}
      </div>

      {!readOnly && (
        <div className="related-relation__view-action">
          {otherDataset&&<details className="relation-columns"><summary>Поля Relation View</summary>{otherDataset.columns.map((column,index)=><label key={column.id}><input type="checkbox" aria-label={`Показывать ${column.name}`} checked={(visibleColumnIds??otherDataset.columns.slice(0,3).map(c=>c.id)).includes(column.id)} onChange={event=>setVisibleColumnIds(current=>{const ids=current??otherDataset.columns.slice(0,3).map(c=>c.id);return event.target.checked?[...ids,column.id]:ids.filter(id=>id!==column.id);})}/>{column.name}</label>)}</details>}
          <button
            disabled={relationViewBusy}
            onClick={async () => {
              setRelationViewBusy(true);
              setMaterializeMessage('');
              try {
                const created = await createRelationView({
                  parentNodeId,
                  relation,
                  dataset: currentDataset,
                  row: currentRow,
                  visibleColumnIds:visibleColumnIds??otherDataset?.columns.slice(0,3).map(c=>c.id),
                });
                setMaterializeMessage(
                  created
                    ? 'Relation View добавлен на canvas.'
                    : 'Relation View для этой связи уже есть.',
                );
              } catch (error) {
                setMaterializeMessage(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setRelationViewBusy(false);
              }
            }}
          >
            <LayoutList size={13} />
            {relationViewBusy ? 'Создание…' : 'Добавить Relation View'}
          </button>
        </div>
      )}

      {matches.length > 0 && otherDataset && !readOnly && (
        <>
          <div className="related-relation__template-picker">
            <label>
              Шаблон дочерних объектов
              <select
                value={effectiveTemplateKey}
                onChange={(event) => setVisualTemplateKey(event.target.value)}
              >
                <optgroup label="Встроенные">
                  <option value="builtin:SERVER">Сервер</option>
                  <option value="builtin:VM">Виртуальная машина</option>
                  <option value="builtin:SWITCH">Коммутатор</option>
                  <option value="builtin:ROUTER">Маршрутизатор</option>
                  <option value="builtin:FIREWALL">Firewall</option>
                  <option value="builtin:DATABASE">База данных</option>
                  <option value="builtin:CLOUD">Cloud</option>
                </optgroup>
                {workspaceTemplates.length > 0 && (
                  <optgroup label="Workspace SVG">
                    {workspaceTemplates.map((template) => (
                      <option
                        key={template.id}
                        value={`workspace:${template.id}`}
                      >
                        {template.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          </div>

          <div className="related-relation__actions">
            <button
              disabled={materializing}
              onClick={showOnCanvas}
              title="Создать живые Shape для связанных строк"
            >
              <GitBranchPlus size={13} />
              {materializing
                ? 'Добавление…'
                : `Показать на canvas (${Math.min(matches.length, 20)})`}
            </button>

            {visibleOnCanvas > 0 && (
              <button
                className="is-secondary"
                onClick={() => {
                  void hideMaterializedRelated(parentNodeId, relation.id)
                    .then((hidden) =>
                      setMaterializeMessage(
                        hidden > 0
                          ? `Скрыто объектов: ${hidden}`
                          : 'На canvas нечего скрывать.',
                      ),
                    )
                    .catch((error) =>
                      setMaterializeMessage(
                        error instanceof Error ? error.message : String(error),
                      ),
                    );
                }}
                title="Убрать только визуальные дочерние объекты"
              >
                <XCircle size={13} />
                Скрыть ({visibleOnCanvas})
              </button>
            )}
          </div>
        </>
      )}

      {visibleOnCanvas > 0 && (
        <div className="related-relation__canvas-state">
          <Network size={12} />
          На canvas: {visibleOnCanvas}
        </div>
      )}

      {materializeMessage && (
        <div className="related-relation__message">{materializeMessage}</div>
      )}

      {matches.length === 0 ? (
        <p className="related-relation__empty">
          {otherDataset
            ? 'Связанные строки не найдены.'
            : 'Загрузка связанного Dataset…'}
        </p>
      ) : (
        <div className="related-records">
          {matches.map(row=><button className="related-record related-record--link" key={row.id} title="Открыть запись" onClick={()=>openDatasetSheet(otherDataset!.id,row.id)}>{datasetRecordLabel(row,otherDataset!)}<PanelTopOpen size={13}/></button>)}



        </div>
      )}
    </article>
  );
}

export function RelatedRecords({
  workspaceId,
  token,
  dataset,
  row,
  parentNodeId,
}: {
  workspaceId: string;
  token: string;
  dataset: DatasetSnapshot;
  row: DatasetRow;
  parentNodeId: string;
}) {
  const [relations, setRelations] = useState<DatasetRelation[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () =>
      api
        .relations(workspaceId, token)
        .then(setRelations)
        .catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
    void load();
    const refresh = () => void load();
    window.addEventListener('modelboard:resources', refresh);
    return () => window.removeEventListener('modelboard:resources', refresh);
  }, [token, workspaceId]);

  const relevant = relations.filter(
    (relation) =>
      relation.sourceDatasetId === dataset.id ||
      relation.targetDatasetId === dataset.id,
  );

  if (error) {
    return <div className="inspector-error">{error}</div>;
  }

  return (
    <section className="inspector-section">
      <h3>
        <Link2 size={14} /> Связанные данные
      </h3>

      {relevant.length === 0 ? (
        <p className="inspector-muted">
          Для этого Dataset пока нет семантических связей.
        </p>
      ) : (
        <div className="related-relations">
          {relevant.map((relation) => (
            <RelatedRelationSection
              key={relation.id}
              relation={relation}
              currentDataset={dataset}
              currentRow={row}
              token={token}
              parentNodeId={parentNodeId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
