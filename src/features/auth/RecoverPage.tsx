import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { t } from '../../i18n/pt-PT';
import { AccountError, recoverAccount } from './accounts';
import { AuthLayout, Field, FormError } from './AuthLayout';
import { useSession } from './session-context';
import { required, validateEmail, validateNewPassword, type FieldErrors } from './validation';

type Fields = 'email' | 'recoveryKey' | 'password' | 'confirm';

export function RecoverPage() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<Fields, string>>({
    email: '',
    recoveryKey: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<FieldErrors<Fields>>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = (field: Fields) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: FieldErrors<Fields> = {
      ...validateNewPassword(values.password, values.confirm),
    };
    const emailError = validateEmail(values.email);
    const keyError = required(values.recoveryKey);
    if (emailError) found.email = emailError;
    if (keyError) found.recoveryKey = keyError;
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      signIn(await recoverAccount(values.email, values.recoveryKey, values.password));
      navigate('/app', { replace: true });
    } catch (error) {
      setFormError(
        error instanceof AccountError
          ? error.code === 'wrong_secret'
            ? t.auth.errors.wrong_recovery
            : t.auth.errors[error.code]
          : t.auth.errors.unexpected,
      );
      setBusy(false);
    }
  }

  const copy = t.auth.recover;
  return (
    <AuthLayout title={copy.title} intro={copy.intro}>
      <form onSubmit={submit} noValidate>
        <Field
          id="email"
          label={t.auth.email}
          type="email"
          autoComplete="username"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <Field
          id="recoveryKey"
          label={copy.recoveryKey}
          autoComplete="off"
          spellCheck={false}
          value={values.recoveryKey}
          onChange={set('recoveryKey')}
          error={errors.recoveryKey}
        />
        <Field
          id="password"
          label={copy.newPassword}
          hint={t.auth.passwordHint}
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <Field
          id="confirm"
          label={t.auth.confirmPassword}
          type="password"
          autoComplete="new-password"
          value={values.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
        />
        <FormError message={formError} />
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? t.auth.working : copy.submit}
        </button>
      </form>
      <p className="auth-alt">
        <Link to="/entrar">{copy.back}</Link>
      </p>
    </AuthLayout>
  );
}
