import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Table, type Column } from './Table';

/**
 * ============================================================
 * TABELA PAGINADA (em memoria)
 * ============================================================
 * Envolve a <Table> com controle de pagina sobre uma lista ja carregada.
 *
 * E paginacao de APRESENTACAO, nao de consulta: serve para a tela nao virar
 * uma rolagem interminavel quando o conjunto cresce. Quem pagina no servidor
 * (como a tela de Logs) continua fazendo isso - aqui os dados ja vieram
 * inteiros na mesma resposta, e ir ao servidor para virar pagina seria uma
 * ida a toa.
 */

interface PaginatedTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  pageSize?: number;
  /** Substantivo do contador: "sessao(oes)", "usuario(s)"... */
  unit?: string;
  /**
   * Volta para a primeira pagina quando este valor muda. Sem isso, trocar o
   * filtro com a tela na pagina 5 mostraria uma pagina vazia do resultado
   * novo.
   */
  resetKey?: unknown;
}

export function PaginatedTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyMessage,
  pageSize = 10,
  unit = 'registro(s)',
  resetKey,
}: PaginatedTableProps<T>) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  // A lista pode encolher sem o resetKey mudar (ex.: dado atualizado em
  // segundo plano). Fixar a pagina no limite evita a tela em branco.
  const current = Math.min(page, totalPages);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div>
      <Table
        columns={columns}
        rows={visible}
        rowKey={rowKey}
        loading={loading}
        emptyMessage={emptyMessage}
      />

      {/* Some quando ha uma pagina so: controle que nunca faz nada e ruido. */}
      {rows.length > pageSize && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            {rows.length} {unit} - pagina {current} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={current <= 1 || loading}
              onClick={() => setPage(current - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={current >= totalPages || loading}
              onClick={() => setPage(current + 1)}
            >
              Proxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
