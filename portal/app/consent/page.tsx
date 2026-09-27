import { consent } from "../content/developerDocs";
import { DocPage, DocSection, Notes, Steps } from "../components/DocBits";

export default function ConsentPage() {
  return (
    <DocPage title={consent.title} intro={consent.intro}>
      <DocSection title="The principle">
        <p className="leading-relaxed" style={{ color: "var(--text-body)" }}>
          {consent.principle}
        </p>
      </DocSection>

      <DocSection title="The consent screen">
        <p className="leading-relaxed" style={{ color: "var(--text-body)" }}>
          {consent.consentScreen}
        </p>
      </DocSection>

      <DocSection title="Withdrawal and retention">
        <Steps steps={consent.withdrawal} />
      </DocSection>

      <DocSection title="Still open" last>
        <Notes notes={consent.openQuestions} tint />
      </DocSection>
    </DocPage>
  );
}
