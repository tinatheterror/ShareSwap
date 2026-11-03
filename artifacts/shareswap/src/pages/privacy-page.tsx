import { LegalDocumentPage } from "./legal-document-page";
// The text lives in docs/legal so it can be reviewed as a document; this page only shows it.
import policy from "../../../../docs/legal/privacy-policy.md?raw";

export default function PrivacyPage() {
  return <LegalDocumentPage source={policy} />;
}
