import { useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import { checkPassword } from '../lib/password';
import { Button } from './ui/Button';
import { Input } from './ui/Field';
import { Modal } from './ui/Modal';
import { PasswordRequirements, PasswordStrengthBar } from './ui/PasswordRequirements';

/**
 * Troca de senha pelo proprio usuario.
 *
 * Antes disso, so um ADMIN trocava senhas - o que obrigava o usuario a
 * entregar a senha a outra pessoa e deixava o administrador conhecendo a
 * credencial de todo mundo. Disponivel para qualquer perfil, pelo cabecalho.
 */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useMemo(
    () => checkPassword(newPassword, { name: user?.name, email: user?.email }),
    [newPassword, user?.name, user?.email],
  );

  const confirmationMismatch = confirmation.length > 0 && confirmation !== newPassword;
  const sameAsCurrent = newPassword.length > 0 && newPassword === currentPassword;
  const canSubmit =
    currentPassword.length > 0 && check.valid && confirmation === newPassword && !sameAsCurrent;

  function reset() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success('Senha alterada com sucesso.');
      handleClose();
    } catch (err) {
      // O erro fica DENTRO do modal (e nao so num toast) porque o usuario
      // precisa dele visivel enquanto corrige os campos.
      const message =
        err instanceof ApiError
          ? (err.fieldErrors?.map((f) => f.message).join(' ') || err.message)
          : 'Nao foi possivel alterar a senha.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Alterar senha"
      subtitle={user?.email}
      onClose={handleClose}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button form="change-password-form" type="submit" loading={saving} disabled={!canSubmit}>
            Salvar nova senha
          </Button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
          >
            {error}
          </p>
        )}

        <Input
          label="Senha atual"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />

        <div>
          <Input
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            error={sameAsCurrent ? 'A nova senha deve ser diferente da atual.' : undefined}
          />
          {newPassword.length > 0 && (
            <>
              <PasswordStrengthBar check={check} />
              <PasswordRequirements check={check} />
            </>
          )}
        </div>

        <Input
          label="Confirmar nova senha"
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          error={confirmationMismatch ? 'As senhas nao conferem.' : undefined}
        />

        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
          Trocar a senha nao encerra sessoes ja abertas em outros dispositivos. Se voce suspeita
          que alguem teve acesso a sua conta, avise um administrador.
        </p>
      </form>
    </Modal>
  );
}
