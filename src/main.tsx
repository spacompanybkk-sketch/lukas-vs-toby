import { render } from 'preact';
import { debugEnabled, installDebug } from './app/debug';
import { isPhone, readDeviceFacts } from './app/phone';

// The test hooks object exists at once (tests read `__lvt.ready` right after load); it is tiny.
installDebug();

// Decided before anything else loads: on a phone only the notice is shown. The game (3D scene,
// audio, cloud client) is a separate chunk that a phone never fetches. `?debug` skips the notice.
if (!debugEnabled(import.meta.env.DEV, location.search) && isPhone(readDeviceFacts())) {
  void import('./ui/PhoneNotice').then(({ PhoneNotice }) => {
    document.getElementById('game')?.remove(); // no canvas, so never a WebGL context
    render(<PhoneNotice />, document.getElementById('ui') as HTMLElement);
  });
} else {
  void import('./app/startGame').then(({ startGame }) => startGame());
}
