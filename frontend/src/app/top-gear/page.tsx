import RemountOnRestore from '../components/share/RemountOnRestore';
import TopGearGameSwitch from './TopGearGameSwitch';

export default function TopGearPage() {
  return (
    <RemountOnRestore>
      <TopGearGameSwitch />
    </RemountOnRestore>
  );
}
