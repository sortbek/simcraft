import RemountOnRestore from '../components/share/RemountOnRestore';
import TopGearScreen from './TopGearScreen';

export default function TopGearPage() {
  return (
    <RemountOnRestore>
      <TopGearScreen />
    </RemountOnRestore>
  );
}
