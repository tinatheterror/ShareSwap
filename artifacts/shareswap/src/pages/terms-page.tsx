import { LegalDocumentPage } from "./legal-document-page";
// The text lives in docs/legal so it can be reviewed as a document; this page only shows it.
import terms from "../../../../docs/legal/terms-of-service.md?raw";

export default function TermsPage() {
  return <LegalDocumentPage source={terms} />;
}
