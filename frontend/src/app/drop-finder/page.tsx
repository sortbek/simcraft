import RemountOnRestore from '../components/share/RemountOnRestore';
import DropFinderGameSwitch from './DropFinderGameSwitch';

export default function DropFinderPage() {
  return (
    <RemountOnRestore>
      <DropFinderGameSwitch />
    </RemountOnRestore>
  );
}
