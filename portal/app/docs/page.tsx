import { apiReference } from "../content/developerDocs";
import { DocPage, DocSection, DocTable, Endpoint, Steps } from "../components/DocBits";

export default function DocsPage() {
  return (
    <DocPage title={apiReference.title} intro={apiReference.intro}>
      <DocSection title="Authentication" intro={apiReference.authIntro}>
        <Steps steps={apiReference.authSteps} />
      </DocSection>

      <DocSection title="Endpoints">
        <div className="space-y-10">
          {apiReference.endpoints.map((endpoint) => (
            <Endpoint key={endpoint.path + endpoint.method} endpoint={endpoint} />
          ))}
        </div>
      </DocSection>

      <DocSection title="Renter phone check (not in the widget yet)" intro={apiReference.otpIntro}>
        <div className="space-y-10">
          {apiReference.otpEndpoints.map((endpoint) => (
            <Endpoint key={endpoint.path} endpoint={endpoint} />
          ))}
        </div>
      </DocSection>

      <DocSection title="Error codes" last>
        <DocTable rows={apiReference.errors} codeColour="var(--danger)" headers={["Code", "HTTP", "Meaning"]} />
      </DocSection>
    </DocPage>
  );
}
