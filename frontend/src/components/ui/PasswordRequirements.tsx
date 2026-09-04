import type { PasswordCheck } from '../../lib/password';

/**
 * Lista as regras da politica de senha marcando quais ja foram atendidas.
 *
 * Mostrar todas as regras o tempo todo (em vez de so o primeiro erro) evita o
 * vai-e-volta de descobrir uma exigencia por vez a cada tentativa.
 */
export function PasswordRequirements({ check }: { check: PasswordCheck }) {
  return (
    <ul className="mt-2 space-y-1" aria-live="polite">
      {check.rules.map((rule) => (
        <li
          key={rule.label}
          className={`flex items-start gap-1.5 text-xs ${
            rule.ok ? 'text-emerald-700' : 'text-slate-500'
          }`}
        >
          <svg
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${rule.ok ? 'text-emerald-500' : 'text-slate-300'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={rule.ok ? 'M5 13l4 4L19 7' : 'M5 12h14'} />
          </svg>
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

/** Barra de forca simples, derivada de quantas regras a senha ja cumpre. */
export function PasswordStrengthBar({ check }: { check: PasswordCheck }) {
  const total = check.rules.length;
  const filled = check.score;
  const tone = check.valid
    ? 'bg-emerald-500'
    : filled >= total - 1
      ? 'bg-amber-500'
      : 'bg-rose-500';

  return (
    <div className="mt-2 flex gap-1" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${i < filled ? tone : 'bg-slate-200'}`}
        />
      ))}
    </div>
  );
}
