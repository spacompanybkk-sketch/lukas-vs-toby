import { showFakeBadge } from '../../app/cloudMode';
import { pageCloudMode } from '../../cloud/restClient';
import { PixelIcon } from '../hud/PixelIcon';
import { TEST_TUBE } from './pictures';
import './players.css';

/**
 * A small boxy test tube in the corner when a production build runs on the fake cloud, so a
 * wrong deploy is visible at a glance. Nothing in live mode, in development, or with `?debug`.
 */
export function FakeBadge() {
  const search = typeof location === 'undefined' ? '' : location.search;
  if (!showFakeBadge(pageCloudMode(), import.meta.env.DEV, search)) return null;
  return (
    <span class="fake-badge px pal-cream" data-fake-cloud aria-label="Test cloud: players are kept on this device only">
      <PixelIcon art={TEST_TUBE} />
    </span>
  );
}
