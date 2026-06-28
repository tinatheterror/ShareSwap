import { ReactNode } from 'react';

interface AppLayoutProps {
  children: ReactNode;
  className?: string;
}

export function AppLayout({ children, className = '' }: AppLayoutProps) {
  return (
    <div className={`min-h-screen flex flex-col ${className}`}>
      <main className="flex-1 layout-container py-4 md:py-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div>
        <h1 className="heading-lg">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm sm:text-base mt-1">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-col sm:flex-row gap-2 mt-2 sm:mt-0">
          {actions}
        </div>
      )}
    </div>
  );
}

interface ContentSectionProps {
  children: ReactNode;
  className?: string;
}

export function ContentSection({ children, className = '' }: ContentSectionProps) {
  return (
    <section className={`layout-stack ${className}`}>
      {children}
    </section>
  );
}
