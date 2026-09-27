import { sdkFlow } from "../content/developerDocs";
import { Code, DocPage, DocSection, DocTable, Notes, Steps } from "../components/DocBits";

export default function FlowPage() {
  return (
    <DocPage title={sdkFlow.title} intro={sdkFlow.intro}>
      <DocSection title="Add it to your page">
        <Steps steps={sdkFlow.setupSteps} />
        <Code>{sdkFlow.setupCode}</Code>
      </DocSection>

      <DocSection title="init() options">
        <DocTable rows={sdkFlow.options} />
      </DocSection>

      <DocSection title="The sequence">
        <Steps steps={sdkFlow.sequence} />
      </DocSection>

      <DocSection title="When things go wrong">
        <Steps steps={sdkFlow.behaviour} />
      </DocSection>

      <DocSection title="Callbacks your page reacts to" intro={sdkFlow.callbacksNote}>
        <DocTable rows={sdkFlow.callbacks} />
      </DocSection>

      <DocSection
        title="SDK error codes"
        intro="What onError receives. Different from the backend codes on the API reference; the widget turns those into one of these."
      >
        <DocTable rows={sdkFlow.errors} codeColour="var(--danger)" />
      </DocSection>

      <DocSection title="Accessibility" intro={sdkFlow.accessibilityIntro}>
        <Code>{sdkFlow.accessibilityCode}</Code>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-body)" }}>
          {sdkFlow.accessibilityNote}
        </p>
      </DocSection>

      <DocSection title="Score bands">
        <DocTable rows={sdkFlow.bands} headers={["Band", "Score"]} />
      </DocSection>

      <DocSection title="Before you integrate">
        <Steps steps={sdkFlow.beforeYouIntegrate} />
      </DocSection>

      <DocSection title="Known issues" last>
        <Notes notes={sdkFlow.knownIssues} />
      </DocSection>
    </DocPage>
  );
}
