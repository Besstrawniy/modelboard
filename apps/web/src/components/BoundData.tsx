import {
  resolveBindingPresentation,
  type ObjectBindingRecord,
} from '@modelboard/shared';
import { useCollaborativeDataset } from '../lib/useCollaborativeDataset';
import { useBoardActions } from './BoardContext';
export function BoundData({ binding }: { binding: ObjectBindingRecord }) {
  const { sessionToken, openDatasetSheet } = useBoardActions();
  const { dataset, status } = useCollaborativeDataset(
    binding.datasetId,
    sessionToken,
    true,
  );
  if (!dataset)
    return (
      <div className="bound-data">
        <strong>
          {status === 'error' || status === 'deleted'
            ? 'Источник недоступен'
            : 'Загрузка данных…'}
        </strong>
      </div>
    );
  const model = resolveBindingPresentation(binding, dataset);
  return (
    <div
      className="bound-data"
      style={{ borderLeftColor: model.color }}
      data-binding-type={binding.type}
    >
      <strong>{model.title}</strong>
      {model.subtitle && <small>{model.subtitle}</small>}
      {model.fields.map((field) => (
        <span className="bound-data__field" key={field.id}>
          {model.showLabels && <em>{field.label}: </em>}
          {field.value}
        </span>
      ))}
      {model.status && (
        <span className="bound-data__status" style={{ color: model.color }}>
          {model.status}
        </span>
      )}
      <button
        className="nodrag"
        title="Перейти к источнику данных"
        onClick={(event) => {
          event.stopPropagation();
          openDatasetSheet(binding.datasetId, binding.rowId);
        }}
      >
        К данным ↗
      </button>
    </div>
  );
}
