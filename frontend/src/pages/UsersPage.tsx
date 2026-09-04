import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { ActiveBadge, PageHeader, RoleBadge } from '../components/ui/Card';
import { Checkbox, Input, Select } from '../components/ui/Field';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { PasswordRequirements, PasswordStrengthBar } from '../components/ui/PasswordRequirements';
import { Table, type Column } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, api } from '../lib/api';
import { formatDate } from '../lib/format';
import { checkPassword, generatePassword } from '../lib/password';
import type { Contract, Role, User } from '../types';

interface FormState {
  name: string;
  email: string;
  password: string;
  role: Role;
  isActive: boolean;
  /** Senha do ADMIN logado, exigida para redefinir a senha de outro ADMIN. */
  currentPassword: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  password: '',
  role: 'VISUALIZADOR',
  isActive: true,
  currentPassword: '',
};

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState<User[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Senha gerada precisa ser lida pelo admin para ser repassada, entao o campo
  // alterna entre oculto e visivel. Comeca oculto em toda abertura do modal.
  const [showPassword, setShowPassword] = useState(false);

  // Modal de associacao de contratos
  const [linking, setLinking] = useState<User | null>(null);
  const [selectedContracts, setSelectedContracts] = useState<string[]>([]);
  const [linkSaving, setLinkSaving] = useState(false);

  const [deleting, setDeleting] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, contractList] = await Promise.all([
        api.get<User[]>('/users'),
        api.get<Contract[]>('/contracts'),
      ]);
      setUsers(userList);
      setContracts(contractList);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar usuarios.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Avalia a senha digitada contra a politica, ja considerando nome/e-mail
  // que estao sendo gravados nesta mesma tela.
  const passwordCheck = useMemo(
    () => checkPassword(form.password, { name: form.name, email: form.email }),
    [form.password, form.name, form.email],
  );

  /**
   * Redefinir a senha de uma conta ADMIN exige que o administrador confirme a
   * PROPRIA senha. Sem isso, um admin assumia a conta de outro em silencio -
   * e passava a agir na auditoria com o nome dele.
   */
  const needsReauth = Boolean(editing && editing.role === 'ADMIN' && form.password);

  /**
   * Preenche o campo com uma senha forte gerada na hora. Nao substitui a
   * digitacao manual: e so mais um caminho para chegar ao mesmo campo, que
   * segue editavel depois de gerado.
   */
  function handleGeneratePassword() {
    try {
      const generated = generatePassword({ name: form.name, email: form.email });
      setForm((prev) => ({ ...prev, password: generated }));
      // Sem revelar, o admin nao teria como repassar a senha ao usuario.
      setShowPassword(true);
    } catch {
      toast.error('Nao foi possivel gerar a senha. Tente novamente.');
    }
  }

  async function handleCopyPassword() {
    try {
      await navigator.clipboard.writeText(form.password);
      toast.success('Senha copiada.');
    } catch {
      // clipboard exige contexto seguro (https ou localhost) e permissao.
      toast.warning('Nao foi possivel copiar. Selecione a senha e copie manualmente.');
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowPassword(false);
    setModalOpen(true);
  }

  function openEdit(user: User) {
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      password: '', // vazio = mantem a senha atual
      role: user.role,
      isActive: user.is_active,
      currentPassword: '',
    });
    setShowPassword(false);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (form.password && !passwordCheck.valid) {
      toast.error('A nova senha nao atende a politica de seguranca.');
      return;
    }
    if (needsReauth && !form.currentPassword) {
      toast.error('Confirme a sua propria senha para redefinir a de um administrador.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await api.put(`/users/${editing.id}`, {
          name: form.name,
          email: form.email,
          role: form.role,
          isActive: form.isActive,
          // So envia a senha se o admin digitou uma nova.
          ...(form.password ? { password: form.password } : {}),
          // Reautenticacao: exigida pelo backend ao redefinir senha de ADMIN.
          ...(needsReauth ? { current_password: form.currentPassword } : {}),
        });
        toast.success('Usuario atualizado.');
      } else {
        await api.post('/users', {
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          isActive: form.isActive,
        });
        toast.success('Usuario criado.');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar o usuario.');
    } finally {
      setSaving(false);
    }
  }

  function openLinkModal(user: User) {
    setLinking(user);
    setSelectedContracts(user.contracts?.map((c) => c.id) ?? []);
  }

  async function handleSaveLinks() {
    if (!linking) return;
    setLinkSaving(true);
    try {
      await api.put(`/users/${linking.id}/contracts`, { contract_ids: selectedContracts });
      toast.success('Contratos associados atualizados.');
      setLinking(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao associar contratos.');
    } finally {
      setLinkSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/users/${deleting.id}`);
      toast.success('Usuario excluido. Os contratos foram preservados.');
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao excluir o usuario.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Usuario',
      render: (u) => (
        <div>
          <p className="font-medium text-slate-800">
            {u.name}
            {u.id === currentUser?.id && (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">voce</span>
            )}
          </p>
          <p className="text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Perfil', render: (u) => <RoleBadge role={u.role} /> },
    {
      key: 'contracts',
      header: 'Contratos',
      render: (u) =>
        u.role === 'ADMIN' ? (
          <span className="text-xs text-slate-500">Todos (ADMIN)</span>
        ) : (
          <span className="tabular-nums text-slate-600">{u.contracts?.length ?? 0}</span>
        ),
    },
    { key: 'status', header: 'Status', render: (u) => <ActiveBadge active={u.is_active} /> },
    {
      key: 'created',
      header: 'Criado em',
      render: (u) => <span className="whitespace-nowrap text-slate-600">{formatDate(u.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Acoes',
      className: 'text-right',
      render: (u) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => openLinkModal(u)} disabled={u.role === 'ADMIN'}>
            Contratos
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
            Editar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-600 hover:bg-rose-50"
            onClick={() => setDeleting(u)}
            disabled={u.id === currentUser?.id}
          >
            Excluir
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Cadastre os usuarios e defina a quais contratos cada um tem acesso."
        action={<Button onClick={openCreate}>Novo usuario</Button>}
      />

      <Table
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        loading={loading}
        emptyMessage="Nenhum usuario cadastrado."
      />

      {/* ---------------------------------------------- Modal de cadastro */}
      <Modal
        open={modalOpen}
        title={editing ? 'Editar usuario' : 'Novo usuario'}
        subtitle={editing?.email}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button form="user-form" type="submit" loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nome"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="E-mail"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <div className="sm:col-span-2">
            {/* Duas formas de definir a senha: digitar ou gerar. O campo é o
                mesmo nos dois casos e continua editável depois de gerado. */}
            <Input
              label={editing ? 'Nova senha' : 'Senha'}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required={!editing}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={showPassword ? 'font-mono' : ''}
              hint={
                editing
                  ? 'Deixe em branco para manter a senha atual.'
                  : 'Digite uma senha ou use "Gerar senha".'
              }
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleGeneratePassword}
                icon={
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                }
              >
                Gerar senha
              </Button>

              {form.password.length > 0 && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={handleCopyPassword}>
                    Copiar
                  </Button>
                </>
              )}
            </div>

            {form.password.length > 0 && (
              <>
                <PasswordStrengthBar check={passwordCheck} />
                <PasswordRequirements check={passwordCheck} />
              </>
            )}

            {showPassword && form.password.length > 0 && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-800">
                Copie a senha agora e entregue ao usuário por um canal seguro. Ela não fica
                guardada em texto legível — depois de salvar, não há como consultá-la.
              </p>
            )}
          </div>

          {/* Reautenticacao ao redefinir a senha de outro administrador. */}
          {needsReauth && (
            <div className="sm:col-span-2">
              <Input
                label="Confirme a SUA senha"
                type="password"
                autoComplete="current-password"
                required
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                hint="Redefinir a senha de um administrador exige confirmar a sua propria identidade."
              />
            </div>
          )}
          <Select
            label="Perfil de acesso"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            disabled={editing?.id === currentUser?.id}
            hint={
              form.role === 'ADMIN'
                ? 'Acesso total a todos os contratos, usuarios e telas.'
                : form.role === 'GESTOR'
                  ? 'Gerencia contratos e iframes dos contratos associados.'
                  : 'Apenas visualiza os paineis dos contratos associados.'
            }
          >
            <option value="ADMIN">Administrador</option>
            <option value="GESTOR">Gestor</option>
            <option value="VISUALIZADOR">Visualizador</option>
          </Select>
          <div className="sm:col-span-2">
            <Checkbox
              label="Usuario ativo"
              checked={form.isActive}
              disabled={editing?.id === currentUser?.id}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
          </div>

          {/* Contas nao-ADMIN nascem so com a tela de Paineis. Sem este aviso,
              o admin cria o usuario e estranha o menu curto no primeiro login. */}
          {!editing && form.role !== 'ADMIN' && (
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 sm:col-span-2">
              Esta conta sera criada com acesso apenas a tela <strong>Paineis</strong>. As demais
              telas (Dashboard, Contratos e Iframes) sao liberadas depois, em{' '}
              <strong>Permissoes</strong>.
            </p>
          )}
        </form>
      </Modal>

      {/* ---------------------------------------------- Modal de contratos */}
      <Modal
        open={Boolean(linking)}
        title="Contratos do usuario"
        subtitle={linking ? `${linking.name} (${linking.email})` : undefined}
        onClose={() => setLinking(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLinking(null)} disabled={linkSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveLinks} loading={linkSaving}>
              Salvar associacoes
            </Button>
          </>
        }
      >
        {contracts.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum contrato cadastrado ainda.</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {contracts.map((contract) => {
              const checked = selectedContracts.includes(contract.id);
              return (
                <label
                  key={contract.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    checked ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedContracts((prev) =>
                        e.target.checked
                          ? [...prev, contract.id]
                          : prev.filter((id) => id !== contract.id),
                      )
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{contract.name}</p>
                    <p className="text-xs text-slate-500">
                      {contract.client_name} &middot; {contract.iframes_count ?? 0} painel(is)
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Excluir usuario"
        message={`Excluir "${deleting?.name}" remove apenas as associacoes de contratos deste usuario. Nenhum contrato sera excluido.`}
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
