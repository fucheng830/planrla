import { useTranslation } from 'react-i18next';

const loadingDotAnimationDelays = ['0s', '0.1s', '0.2s'];

export default function AuthLoadingScreen() {
  const { t } = useTranslation('auth');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <img src="/logo.svg" alt="Planrla" className="h-16 w-16" />
        </div>

        <h1 className="mb-2 text-2xl font-bold text-foreground">Planrla</h1>

        <div className="flex items-center justify-center space-x-2">
          {loadingDotAnimationDelays.map((delay) => (
            <div
              key={delay}
              className="h-2 w-2 animate-bounce rounded-full bg-primary"
              style={{ animationDelay: delay }}
            />
          ))}
        </div>

        <p className="mt-2 text-muted-foreground">{t('loading')}</p>
      </div>
    </div>
  );
}
