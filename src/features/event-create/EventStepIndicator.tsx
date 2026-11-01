const STEPS = ['基本情報', '候補日時', '確認'];

export function EventStepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <ol className="event-steps" aria-label="イベント作成の進捗">
      {STEPS.map((label, index) => (
        <li key={label} aria-current={currentStep === index + 1 ? 'step' : undefined}
          className={currentStep > index + 1 ? 'is-complete' : undefined}>
          <span className="event-step-number" aria-hidden="true">{currentStep > index + 1 ? '✓' : index + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
