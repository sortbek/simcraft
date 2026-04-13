import DropFinderContent from '../DropFinderContent';

export function generateStaticParams() {
  // Placeholder so static export generates the page template.
  // Actual source is read client-side via the param.
  return [{ source: '_' }];
}

export default async function DropFinderPage({ params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  return <DropFinderContent category={source} />;
}
