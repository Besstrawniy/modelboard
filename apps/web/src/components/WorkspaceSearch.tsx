import {
  Database,
  LayoutDashboard,
  Search,
  Shapes,
  X,
} from 'lucide-react';
import type {
  BoardDatasetLocation,
  WorkspaceSearchResult,
} from '@modelboard/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

export function WorkspaceSearch({
  workspaceId,
  token,
  onClose,
  onSwitchBoard,
  onOpenDataset,
  onNavigateObject,
}: {
  workspaceId: string;
  token: string;
  onClose: () => void;
  onSwitchBoard: (boardId: string) => void | Promise<void>;
  onOpenDataset: (datasetId: string, rowId?: string) => void;
  onNavigateObject: (
    location: BoardDatasetLocation,
    rowId?: string,
  ) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<WorkspaceSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const normalized = queryText.trim();

    if (normalized.length < 2) {
      setResults([]);
      setSelectedIndex(0);
      setBusy(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError('');

      void api
        .searchWorkspace(workspaceId, token, normalized)
        .then((items) => {
          if (cancelled) return;
          setResults(items);
          setSelectedIndex(0);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(
            err instanceof Error ? err.message : String(err),
          );
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [queryText, token, workspaceId]);

  const selected = results[selectedIndex];

  const open = async (result: WorkspaceSearchResult) => {
    if (result.kind === 'BOARD') {
      await onSwitchBoard(result.boardId);
      onClose();
      return;
    }

    if (result.kind === 'DATASET') {
      onOpenDataset(result.datasetId);
      onClose();
      return;
    }

    await onNavigateObject(
      {
        boardId: result.boardId,
        boardName: result.boardName,
        objectId: result.objectId,
        objectType: result.objectType,
        datasetId: result.datasetId ?? '',
        rowId: result.rowId,
        columnId: result.columnId,
      },
      result.rowId ?? undefined,
    );
    onClose();
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, WorkspaceSearchResult[]>();

    for (const result of results) {
      const label =
        result.kind === 'BOARD'
          ? 'Доски'
          : result.kind === 'DATASET'
            ? 'Datasets'
            : 'Объекты';
      groups.set(label, [...(groups.get(label) ?? []), result]);
    }

    return Array.from(groups.entries());
  }, [results]);

  return (
    <div
      className="workspace-search-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="workspace-search"
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedIndex((value) =>
              Math.min(results.length - 1, value + 1),
            );
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedIndex((value) =>
              Math.max(0, value - 1),
            );
          } else if (event.key === 'Enter' && selected) {
            event.preventDefault();
            void open(selected);
          }
        }}
      >
        <header className="workspace-search__input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={queryText}
            placeholder="Найти Board, Dataset, сервер, VM…"
            onChange={(event) =>
              setQueryText(event.target.value)
            }
          />
          {busy && <span className="workspace-search__busy">поиск…</span>}
          <button className="icon-button" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="workspace-search__results">
          {queryText.trim().length < 2 ? (
            <div className="workspace-search__empty">
              Введите минимум 2 символа. Поиск работает по именам Board/Dataset
              и значениям связанных строк.
            </div>
          ) : error ? (
            <div className="workspace-search__error">{error}</div>
          ) : !busy && results.length === 0 ? (
            <div className="workspace-search__empty">
              Ничего не найдено.
            </div>
          ) : (
            grouped.map(([label, items]) => (
              <div className="workspace-search__group" key={label}>
                <div className="workspace-search__group-title">
                  {label}
                </div>
                {items.map((result) => {
                  const index = results.indexOf(result);
                  const Icon =
                    result.kind === 'BOARD'
                      ? LayoutDashboard
                      : result.kind === 'DATASET'
                        ? Database
                        : Shapes;

                  return (
                    <button
                      key={result.id}
                      className={
                        index === selectedIndex ? 'is-selected' : ''
                      }
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => void open(result)}
                    >
                      <span className="workspace-search__icon">
                        <Icon size={15} />
                      </span>
                      <span className="workspace-search__copy">
                        <strong>{result.title}</strong>
                        <small>{result.subtitle}</small>
                      </span>
                      <kbd>↵</kbd>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <footer>
          <span>↑↓ выбор</span>
          <span>Enter открыть</span>
          <span>Esc закрыть</span>
        </footer>
      </section>
    </div>
  );
}
