import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type SetupFormState = {
  username: string;
  password: string;
  confirmPassword: string;
};

const initialState: SetupFormState = {
  username: '',
  password: '',
  confirmPassword: '',
};

/**
 * Validates the account-setup form state.
 * @returns An error message string if validation fails, or `null` when the
 *   form is valid.
 */
function validateSetupForm(formState: SetupFormState, t: TFunction<'auth'>): string | null {
  if (!formState.username.trim() || !formState.password || !formState.confirmPassword) {
    return t('setup.errors.requiredFields');
  }

  if (formState.username.trim().length < 3) {
    return t('setup.errors.usernameTooShort');
  }

  if (formState.password.length < 6) {
    return t('setup.errors.passwordTooShort');
  }

  if (formState.password !== formState.confirmPassword) {
    return t('setup.errors.passwordMismatch');
  }

  return null;
}

/**
 * Account setup / registration form.
 * Uses `autoComplete="new-password"` on password fields so that password
 * managers recognise this as a registration flow and offer to save the new
 * credentials after submission.
 */
export default function SetupForm() {
  const { t } = useTranslation('auth');
  const { register } = useAuth();

  const [formState, setFormState] = useState<SetupFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof SetupFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      const validationError = validateSetupForm(formState, t);
      if (validationError) {
        setErrorMessage(validationError);
        return;
      }

      setIsSubmitting(true);
      const result = await register(formState.username.trim(), formState.password);
      if (!result.success) {
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState, register, t],
  );

  return (
    <AuthScreenLayout
      title={t('setup.title')}
      description={t('setup.description')}
      footerText={t('setup.footer')}
      logo={<img src="/logo.svg" alt="Planrla" className="h-16 w-16" />}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="username"
          name="username"
          label={t('setup.username')}
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder={t('setup.placeholders.username')}
          isDisabled={isSubmitting}
          autoComplete="username"
        />

        <AuthInputField
          id="password"
          name="password"
          label={t('setup.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('setup.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
        />

        <AuthInputField
          id="confirmPassword"
          name="confirmPassword"
          label={t('setup.confirmPassword')}
          value={formState.confirmPassword}
          onChange={(value) => updateField('confirmPassword', value)}
          placeholder={t('setup.placeholders.confirmPassword')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="new-password"
        />

        <AuthErrorAlert errorMessage={errorMessage} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="ds-focus-ring w-full rounded-md bg-workbench-accent px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? t('setup.loading') : t('setup.submit')}
        </button>
      </form>
    </AuthScreenLayout>
  );
}
