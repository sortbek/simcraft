import RemountOnRestore from '../components/share/RemountOnRestore';
import DropFinderContent from './DropFinderContent';

export default function DropFinderPage() {
  return (
    <RemountOnRestore>
      <DropFinderContent />
    </RemountOnRestore>
  );
}
