import SimResultClient from './SimResultClient';

export function generateStaticParams() {
  // Placeholder so static export generates the page template.
  // Actual ID is read client-side via useParams().
  return [{ id: '_' }];
}

export default function SimResultPage() {
  return <SimResultClient />;
}
