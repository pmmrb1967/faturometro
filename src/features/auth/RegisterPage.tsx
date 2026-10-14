import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { isGuest } from '../../db/profiles';
import { AccountError, convertGuest, createAccount, type UnlockedAccount } from './accounts';
import { AuthLayout, Field, FormError } from './AuthLayout';
import { RecoveryKeyStep } from './RecoveryKeyStep';
import { useSession } from './session-context';
import { validateRegister, type FieldErrors } from './validation';

export function RegisterPage() {
  const { session, signIn, updateProfile } = useSession();
  // From the guest, the account keeps its data (same key, now protected by the password).
  const converting = session !== null && isGuest(session.profile);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors<'email' | 'password' | 'confirm'>>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ account: UnlockedAccount; recoveryKey: string }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateRegister({ email, password, confirm });
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      if (session && converting) {
        const { profile, recoveryKey } = await convertGuest(
          { profile: session.profile, masterKey: session.masterKey },
          email,
          password,
        );
        setCreated({ account: { profile, masterKey: session.masterKey }, recoveryKey });
      } else {
        const { recoveryKey, ...account } = await createAccount(email, password);
        setCreated({ account, recoveryKey });
      }
    } catch (error) {
      setFormError(
        error instanceof AccountError && error.code === 'email_taken'
          ? t.auth.errors.email_taken
          : t.auth.errors.unexpected,
      );
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <RecoveryKeyStep
        email={created.account.profile.email}
        recoveryKey={created.recoveryKey}
        onDone={() => {
          if (converting) updateProfile(created.account.profile);
          else signIn(created.account);
          navigate('/app', { replace: true });
        }}
      />
    );
  }

  const copy = t.auth.register;
  return (
    <AuthLayout title={copy.title} intro={converting ? copy.convertIntro : copy.intro}>
      <form onSubmit={submit} noValidate>
        <Field
          id="email"
          label={t.auth.email}
          hint={t.auth.emailHint}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
        />
        <Field
          id="password"
          label={t.auth.password}
          hint={t.auth.passwordHint}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
        />
        <Field
          id="confirm"
          label={t.auth.confirmPassword}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={errors.confirm}
        />
        <FormError message={formError} />
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? t.auth.working : copy.submit}
        </button>
      </form>
      {!converting && (
        <p className="auth-alt">
          {copy.haveAccount} <Link to="/entrar">{t.auth.login.submit}</Link>
        </p>
      )}
    </AuthLayout>
  );
}
