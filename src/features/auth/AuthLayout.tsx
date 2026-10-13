import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { t } from '../../i18n/pt-PT';
import './auth.css';

export { Field } from '../../components/Field';

export function AuthLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="auth">
      <Link to="/" className="brand auth-brand">
        <img src="/icon.svg" alt="" width={32} height={32} />
        {t.appName}
      </Link>
      <main className="auth-card">
        <h1>{title}</h1>
        <p className="auth-intro">{intro}</p>
        {children}
      </main>
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  );
}
