// Title screen shown on every start: reel-style title, a two-step how-to, TUTORIAL / PLAY.

export function introHtml(tutorialDone) {
    return `<div class="intro">
        <div class="kicker intro-kicker">AN FPS WHERE</div>
        <div class="title intro-title">YOU DRAW THE MAP</div>
        <div class="howto">
            <div class="card">
                <div class="card-head"><span class="num">1</span>DRAW <em>· 60 S</em></div>
                <ul>
                    <li><span class="key">1</span><b>RIBBON</b>ramps &amp; bridges in the air</li>
                    <li><span class="key">2</span><b>GROUND</b>flat paths · close a loop for a platform</li>
                    <li><span class="key">3</span><b>WALL</b>cover to hide behind</li>
                    <li class="muted">The whole lobby draws at the same time.</li>
                </ul>
            </div>
            <div class="card">
                <div class="card-head"><span class="num">2</span>FIGHT ON IT</div>
                <ul class="grid">
                    <li><b>WASD</b>move</li><li><b>MOUSE</b>look</li>
                    <li><b>LMB</b>fire</li><li><b>RMB</b>aim</li>
                    <li><b>SPACE</b>jump · double · hold to glide</li><li><b>SHIFT</b>sprint</li>
                    <li><b>1 2 Q</b>weapons</li><li><b>R</b>reload · <b>ESC</b>pause</li>
                </ul>
            </div>
        </div>
        <div class="row-btns intro-btns">
            <button class="btn ${tutorialDone ? '' : 'primary'}" data-act="tutorial">
                <b>TUTORIAL</b><span>learn it in two minutes</span>
            </button>
            <button class="btn ${tutorialDone ? 'primary' : ''}" data-act="play">
                <b>PLAY</b><span>pick a mode</span>
            </button>
        </div>
    </div>
    <div class="credit">inspired by @bonkbureau — "an fps where you draw the map"</div>`;
}
