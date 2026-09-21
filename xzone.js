    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, doc, getDoc, setDoc, collection, addDoc, getDocs, updateDoc, increment, orderBy, query, limit, startAfter, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

    const firebaseConfig = {
      apiKey: "AIzaSyA1iDuDw0AJN1wTfkqzLES5-Zcp2_SAJ-c",
      authDomain: "test-mode-320.firebaseapp.com",
      databaseURL: "https://test-mode-320-default-rtdb.firebaseio.com",
      projectId: "test-mode-320"
    };
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    let lastDoc = null, allLoaded = false, cachedProfile = null;
    const POSTS_PER_PAGE = 10;

    // ====== STATIC PROFILE (no longer loaded from Firebase) ======
    const PROFILE_NAME = "JAKIR AHMED";
    const PROFILE_AVATAR = "assets/img/favicon.png";
    const POST_CONTENT_LIMIT = 220;

    // ====== USER ID (session-based views) ======
    const getUserId = () => {
      let uid = localStorage.getItem("xzbd_uid");
      if (!uid) { uid = "u_" + Math.random().toString(36).slice(2,10); localStorage.setItem("xzbd_uid", uid); }
      return uid;
    };

    // ====== SESSION VIEWED SET (prevents duplicate view counts) ======
    const getViewedSet = () => {
      try { return new Set(JSON.parse(sessionStorage.getItem("xzbd_viewed") || "[]")); }
      catch { return new Set(); }
    };
    const markViewed = (postId) => {
      const s = getViewedSet(); s.add(postId);
      sessionStorage.setItem("xzbd_viewed", JSON.stringify([...s]));
    };

    // ====== HELPERS ======
    function formatCount(n) {
      n = parseInt(n) || 0;
      if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,'') + 'M';
      if (n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/,'') + 'K';
      return n.toString();
    }

    function parseEmojis(text) {
      if (!text) return "";
      const regex = /\p{Emoji_Presentation}/gu;
      return text.replace(regex, (match) => {
        const hex = Array.from(match).map(c => c.codePointAt(0).toString(16)).join("-");
        return `<img class="ios-emoji" src="https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.0.1/img/apple/64/${hex}.png" alt="${match}" onerror="this.replaceWith('${match}')" />`;
      });
    }

    function parseLinks(text) {
      if (!text) return text;
      const urlRegex = /(https?:\/\/[^\s<]+)/g;
      const linked = text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener" class="caption-link">View link</a>');
      return parseEmojis(linked);
    }

    function timeAgo(ts) {
      const now = Date.now() / 1000;
      const sec = now - (ts?.seconds || now);
      if (sec < 60) return "Just now";
      if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
      if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
      if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
      if (sec < 2592000) return `${Math.floor(sec / 604800)}w ago`;
      if (sec < 31536000) return `${Math.floor(sec / 2592000)}mo ago`;
      return new Date((ts?.seconds || now) * 1000).toLocaleDateString("en-US", { day:"numeric", month:"short", year:"numeric" });
    }

    // ====== POST CONTENT — See more / See less ======
    function buildContentHtml(text) {
      if (!text) return "";
      if (text.length <= POST_CONTENT_LIMIT) {
        return `<p class="post-content">${parseLinks(text)}</p>`;
      }
      return `<p class="post-content" data-expanded="false">${parseLinks(text.slice(0, POST_CONTENT_LIMIT))}… <span class="see-more-btn">See more</span></p>`;
    }

    // ====== FIREBASE ======
    async function loadProfile() {
      try {
        // Try localStorage cache first for instant paint
        const cached = localStorage.getItem("xzbd_profile_cache");
        if (cached) {
          const obj = JSON.parse(cached);
          // Use cache immediately, then refresh in background
          renderProfile(obj);
        }
        const snap = await getDoc(doc(db, "profile", "main"));
        const data = snap.exists() ? snap.data() : null;
        if (data) localStorage.setItem("xzbd_profile_cache", JSON.stringify(data));
        return data;
      } catch {
        const cached = localStorage.getItem("xzbd_profile_cache");
        return cached ? JSON.parse(cached) : null;
      }
    }

    async function loadPosts(loadMore = false) {
      try {
        let q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(POSTS_PER_PAGE));
        if (loadMore && lastDoc) q = query(collection(db, "posts"), orderBy("createdAt", "desc"), startAfter(lastDoc), limit(POSTS_PER_PAGE));
        const snap = await getDocs(q);
        if (snap.empty) { allLoaded = true; return []; }
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < POSTS_PER_PAGE) allLoaded = true;
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch { allLoaded = true; return []; }
    }

    async function loadSinglePost(postId) {
      try {
        const snap = await getDoc(doc(db, "posts", postId));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
      } catch { return null; }
    }

    // ====== OG META UPDATE (for link previews) ======
    function updateOGMeta({ title, description, image, url }) {
      const setMeta = (id, val) => { const el = document.getElementById(id); if (el && val) el.setAttribute("content", val); };
      if (title) document.title = title;
      setMeta("og-title", title);
      setMeta("og-description", description);
      setMeta("og-image", image);
      setMeta("og-url", url || location.href);
      setMeta("tw-title", title);
      setMeta("tw-description", description);
      setMeta("tw-image", image);
    }

    // ====== POST URL HELPERS (path-based: /postId instead of ?post=postId) ======
    function getPostIdFromUrl() {
      const parts = location.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && last.toLowerCase() !== "index.html") return last;
      // Backward-compatible fallback for old query-param links
      return new URLSearchParams(location.search).get("post");
    }
    function buildPostUrl(postId) {
      const u = new URL(location.href);
      let path = u.pathname.replace(/index\.html$/i, "");
      if (!path.endsWith("/")) path += "/";
      u.pathname = path + postId;
      u.search = "";
      return u.toString();
    }
    window.clearPostFilter = function() {
      const u = new URL(location.href);
      let dir = u.pathname;
      dir = dir.substring(0, dir.lastIndexOf("/") + 1) || "/";
      history.pushState({}, "", dir);
      document.getElementById("singlePostBanner").style.display = "none";
      lastDoc = null; allLoaded = false;
      appendPosts(false);
    };

    // ====== RENDER PROFILE ======
    // Name / org / title / avatar / cover / bio / location / joined / birthday / email / phone
    // are now static and already set directly in the HTML. Only social links (still stored
    // in Firebase) and default share-preview meta tags are handled here.
    function renderProfile(p) {
      const socials = document.getElementById("socialLinks");
      socials.innerHTML = "";
      const slinks = p && Array.isArray(p.socialLinks) ? p.socialLinks : [];
      if (slinks.length === 0) {
        socials.innerHTML = `<div style="padding:16px;text-align:center;color:var(--sub);font-size:13px;">No social links</div>`;
      } else {
        slinks.forEach(l => {
          const btn = document.createElement("a");
          btn.href = l.url; btn.target = "_blank"; btn.rel = "noopener";
          btn.className = "social-link-btn";
          btn.innerHTML = `<span class="sl-icon" style="background:${l.color||'#007aff'};"><i class="${l.icon||'fa-solid fa-link'}"></i></span><span class="sl-label">${l.label||'Link'}</span><span class="sl-cta">Visit</span>`;
          socials.appendChild(btn);
        });
      }

      updateOGMeta({
        title: `${PROFILE_NAME} — X ZONE BD`,
        description: "Developer and founder of X ZONE BD. Passionate about coding, design, and creating new things.",
        image: PROFILE_AVATAR,
        url: location.href
      });
    }

    // ====== VIDEO PLAYER ======
    function makeVideoPlayer(src) {
      return `<div class="cvp-wrap" data-src="${src}">
        <video class="cvp-video" src="${src}" playsinline preload="metadata"></video>
        <div class="cvp-overlay">
          <button class="cvp-play-btn"><svg viewBox="0 0 24 24" fill="white" width="36" height="36"><polygon points="5,3 19,12 5,21"/></svg></button>
        </div>
        <div class="cvp-controls" style="display:none;">
          <button class="cvp-pp"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" class="cvp-play-icon"><polygon points="5,3 19,12 5,21"/></svg><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" class="cvp-pause-icon" style="display:none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>
          <div class="cvp-progress-wrap"><div class="cvp-progress"><div class="cvp-progress-fill"></div></div></div>
          <span class="cvp-time">0:00</span>
          <button class="cvp-mute"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" class="cvp-vol-icon"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" class="cvp-muted-icon" style="display:none;"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="3" x2="17" y2="9"/><line x1="17" y1="3" x2="23" y2="9"/></svg></button>
        </div>
      </div>`;
    }

    function initVideoPlayers(container) {
      container.querySelectorAll(".cvp-wrap").forEach(wrap => {
        const vid = wrap.querySelector(".cvp-video");
        const overlay = wrap.querySelector(".cvp-overlay");
        const controls = wrap.querySelector(".cvp-controls");
        const ppBtn = wrap.querySelector(".cvp-pp");
        const playIcon = wrap.querySelector(".cvp-play-icon");
        const pauseIcon = wrap.querySelector(".cvp-pause-icon");
        const fill = wrap.querySelector(".cvp-progress-fill");
        const progress = wrap.querySelector(".cvp-progress");
        const timeEl = wrap.querySelector(".cvp-time");
        const muteBtn = wrap.querySelector(".cvp-mute");
        const volIcon = wrap.querySelector(".cvp-vol-icon");
        const mutedIcon = wrap.querySelector(".cvp-muted-icon");
        const bigPlay = wrap.querySelector(".cvp-play-btn");

        const togglePlay = () => {
          if (vid.paused) { vid.play(); controls.style.display="flex"; overlay.style.opacity="0"; }
          else { vid.pause(); overlay.style.opacity="1"; }
        };
        bigPlay.addEventListener("click", togglePlay);
        ppBtn.addEventListener("click", togglePlay);
        vid.addEventListener("play", () => { playIcon.style.display="none"; pauseIcon.style.display=""; overlay.style.opacity="0"; controls.style.display="flex"; });
        vid.addEventListener("pause", () => { playIcon.style.display=""; pauseIcon.style.display="none"; overlay.style.opacity="1"; });
        vid.addEventListener("ended", () => { overlay.style.opacity="1"; playIcon.style.display=""; pauseIcon.style.display="none"; });
        vid.addEventListener("timeupdate", () => {
          if (!vid.duration) return;
          fill.style.width = (vid.currentTime/vid.duration*100)+"%";
          const m = Math.floor(vid.currentTime/60), s = Math.floor(vid.currentTime%60);
          timeEl.textContent = `${m}:${s.toString().padStart(2,"0")}`;
        });
        progress.addEventListener("click", e => {
          const r = progress.getBoundingClientRect();
          vid.currentTime = ((e.clientX - r.left)/r.width) * vid.duration;
        });
        muteBtn.addEventListener("click", () => {
          vid.muted = !vid.muted;
          volIcon.style.display = vid.muted ? "none" : "";
          mutedIcon.style.display = vid.muted ? "" : "none";
        });
        const io = new IntersectionObserver(entries => {
          entries.forEach(e => { if (!e.isIntersecting && !vid.paused) vid.pause(); });
        }, { threshold: 0.2 });
        io.observe(wrap);
      });
    }

    // ====== COMMENTS ======
    async function loadComments(postId) {
      try {
        const snap = await getDocs(collection(db, "posts", postId, "comments"));
        const list = snap.docs.map(d => ({id:d.id,...d.data()}));
        // Owner comment(s) pinned at top; within each group, newest first
        list.sort((a, b) => {
          if (a.isOwner && !b.isOwner) return -1;
          if (!a.isOwner && b.isOwner) return 1;
          return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });
        return list;
      } catch { return []; }
    }

    let pendingCommentText = null, pendingPostId = null, cooldownInterval = null;
    const COMMENT_COOLDOWN_MS = 2 * 60 * 1000;

    function updateCooldownUI() {
      const lastTime = parseInt(localStorage.getItem("xzbd_last_comment_time") || "0");
      const remain = COMMENT_COOLDOWN_MS - (Date.now() - lastTime);
      const note = document.getElementById("cmtCooldownNote");
      const btn = document.getElementById("cmtSubmitBtn");
      if (remain > 0) {
        const s = Math.ceil(remain / 1000);
        note.style.display = "block";
        note.textContent = `You can comment again in ${s}s`;
        btn.disabled = true;
        if (!cooldownInterval) cooldownInterval = setInterval(updateCooldownUI, 1000);
      } else {
        note.style.display = "none";
        btn.disabled = false;
        if (cooldownInterval) { clearInterval(cooldownInterval); cooldownInterval = null; }
      }
    }

    function openCommentModal(postId) {
      const overlay = document.getElementById("commentModal");
      overlay.dataset.postId = postId;
      document.getElementById("cmtPostId").value = postId;
      document.getElementById("cmtText").value = "";
      overlay.classList.add("open");
      updateCooldownUI();
      refreshCommentList(postId);
    }
    window.openCommentModal = openCommentModal;

    async function refreshCommentList(postId) {
      const list = document.getElementById("cmtList");
      list.innerHTML = `<div class="cmt-loading">Loading...</div>`;
      const comments = await loadComments(postId);
      if (comments.length === 0) { list.innerHTML=`<div class="cmt-empty">No comments yet. Be the first to comment!</div>`; return; }
      list.innerHTML = "";
      comments.forEach(c => {
        const d = document.createElement("div");
        d.className = "cmt-item";
        const time = c.createdAt?.seconds ? timeAgo({seconds:c.createdAt.seconds}) : "";
        let avHtml = c.isOwner
          ? `<img src="${PROFILE_AVATAR}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`
          : `<div class="cmt-avatar-text">${(c.name||"?")[0].toUpperCase()}</div>`;
        const nameHtml = c.isOwner
          ? `OWNER <span class="owner-badge"><i class="fa-solid fa-circle-check"></i></span>`
          : (c.name||"Anonymous");
        d.innerHTML = `
          <div class="cmt-avatar ${c.isOwner?'owner-cmt':''}">${avHtml}</div>
          <div class="cmt-body">
            <div class="cmt-name">${nameHtml}<span class="cmt-time">${time}</span></div>
            <div class="cmt-text">${parseEmojis(c.text||"")}</div>
          </div>`;
        list.appendChild(d);
      });
    }

    async function submitComment(postId, name, text) {
      const btn = document.getElementById("cmtSubmitBtn");
      btn.disabled = true;
      try {
        await addDoc(collection(db, "posts", postId, "comments"), {
          name, text,
          uid: getUserId(),
          isOwner: false,
          createdAt: serverTimestamp()
        });
        localStorage.setItem("xzbd_last_comment_time", Date.now().toString());
        document.getElementById("cmtText").value = "";
        await refreshCommentList(postId);
        const countEl = document.querySelector(`.comment-count[data-post="${postId}"]`);
        if (countEl) { const n = parseInt(countEl.dataset.n||0)+1; countEl.dataset.n=n; countEl.textContent=formatCount(n); }
      } catch(err) { showShareToast("Failed to send comment"); }
      updateCooldownUI();
    }

    // Send button — using div not form, so no page reload risk
    document.getElementById("cmtSubmitBtn").addEventListener("click", async () => {
      const postId = document.getElementById("cmtPostId").value;
      const text = document.getElementById("cmtText").value.trim();
      if (!text) { showShareToast("Please write a comment"); return; }

      const lastTime = parseInt(localStorage.getItem("xzbd_last_comment_time") || "0");
      if (Date.now() - lastTime < COMMENT_COOLDOWN_MS) { updateCooldownUI(); return; }

      const savedName = localStorage.getItem("xzbd_name") || "";
      if (!savedName) {
        pendingCommentText = text;
        pendingPostId = postId;
        document.getElementById("nameModal").classList.add("open");
        return;
      }
      await submitComment(postId, savedName, text);
    });

    // Also allow Enter key in textarea (Shift+Enter = newline)
    document.getElementById("cmtText").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        document.getElementById("cmtSubmitBtn").click();
      }
    });

    document.getElementById("closeCommentModal").addEventListener("click", () => document.getElementById("commentModal").classList.remove("open"));
    document.getElementById("commentModal").addEventListener("click", e => { if (e.target === document.getElementById("commentModal")) document.getElementById("commentModal").classList.remove("open"); });

    // ====== NAME MODAL (asked once, before the first comment) ======
    document.getElementById("nameModalSubmit").addEventListener("click", async () => {
      const name = document.getElementById("nameModalInput").value.trim();
      if (!name) { showShareToast("Please enter your name"); return; }
      localStorage.setItem("xzbd_name", name);
      document.getElementById("nameModal").classList.remove("open");
      document.getElementById("nameModalInput").value = "";
      if (pendingCommentText && pendingPostId) {
        await submitComment(pendingPostId, name, pendingCommentText);
        pendingCommentText = null; pendingPostId = null;
      }
    });
    document.getElementById("closeNameModal").addEventListener("click", () => document.getElementById("nameModal").classList.remove("open"));
    document.getElementById("nameModal").addEventListener("click", e => { if (e.target === document.getElementById("nameModal")) document.getElementById("nameModal").classList.remove("open"); });

    // ====== SHARE SHEET ======
    function openShareSheet(url) {
      document.getElementById("shareSheetUrl").value = url;
      document.getElementById("shareSheet").classList.add("open");
      const enc = encodeURIComponent(url);
      document.getElementById("shareWhatsApp").href = `https://wa.me/?text=${enc}`;
      document.getElementById("shareFacebook").href = `https://www.facebook.com/sharer/sharer.php?u=${enc}`;
      document.getElementById("shareTwitter").href = `https://twitter.com/intent/tweet?url=${enc}`;
      document.getElementById("shareTelegram").href = `https://t.me/share/url?url=${enc}`;
    }

    document.getElementById("closeShareSheet").addEventListener("click", () => document.getElementById("shareSheet").classList.remove("open"));
    document.getElementById("shareSheet").addEventListener("click", e => { if (e.target === document.getElementById("shareSheet")) document.getElementById("shareSheet").classList.remove("open"); });
    document.getElementById("shareCopyLink").addEventListener("click", async () => {
      const url = document.getElementById("shareSheetUrl").value;
      try { await navigator.clipboard.writeText(url); }
      catch {
        const tmp = document.createElement("input"); tmp.value=url;
        document.body.appendChild(tmp); tmp.select(); document.execCommand("copy"); document.body.removeChild(tmp);
      }
      showShareToast("Link copied! ✓");
      document.getElementById("shareSheet").classList.remove("open");
    });

    function showShareToast(msg) {
      const t = document.createElement("div");
      t.className = "share-toast"; t.textContent = msg||"Link copied!";
      document.body.appendChild(t);
      setTimeout(()=>t.classList.add("show"),10);
      setTimeout(()=>{t.classList.remove("show");setTimeout(()=>t.remove(),300);},2500);
    }

    // ====== RENDER POST ======
    function renderPost(p) {
      const liked = JSON.parse(localStorage.getItem("xzbd_liked")||"{}");
      const userReact = liked[p.id];
      const time = timeAgo(p.createdAt);
      const avatarHtml = `<img src="${PROFILE_AVATAR}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
      const name = PROFILE_NAME;

      // Image with blur-load effect
      let mediaHtml = "";
      if (p.image) {
        mediaHtml = `<div class="post-img-wrap"><img 
          src="${p.image}" 
          alt="post" 
          loading="lazy" 
          class="post-img" 
          onerror="this.parentElement.style.display='none'" 
          oncontextmenu="return false;" 
          draggable="false"
          onload="this.classList.add('loaded')"
        /></div>`;
      } else if (p.video) {
        mediaHtml = `<div class="post-img-wrap">${makeVideoPlayer(p.video)}</div>`;
      }

      const likesCount = parseInt(p.likes||0);
      const viewsCount = parseInt(p.views||0);
      const contentHtml = buildContentHtml(p.content);

      // Per-post unique URL
      const postUrl = buildPostUrl(p.id);

      const div = document.createElement("div");
      div.className = "post-card lazy-item";
      div.dataset.postId = p.id;
      div.innerHTML = `
        <div class="post-header">
          <div class="post-avatar">${avatarHtml}</div>
          <div class="post-meta">
            <span class="post-name">${name} <span class="verified-badge" style="font-size:13px;"><i class="fa-solid fa-circle-check"></i></span></span>
            <span class="post-time">${time}</span>
          </div>
        </div>
        ${contentHtml}
        ${mediaHtml}
        <div class="post-actions">
          <div class="like-container">
            <button class="action-btn like-btn ${userReact?'liked':''}" data-id="${p.id}" data-likes="${likesCount}">
              ${userReact ? parseEmojis(userReact) : '<i class="fa-regular fa-thumbs-up"></i>'}
              <span class="like-count">${formatCount(likesCount)}</span>
            </button>
            <div class="react-panel">
              <div class="react-emoji" data-react="👍" data-name="Like">👍</div>
              <div class="react-emoji" data-react="🌺" data-name="Love">🌺</div>
              <div class="react-emoji" data-react="😂" data-name="Haha">😂</div>
              <div class="react-emoji" data-react="😮" data-name="Wow">😮</div>
              <div class="react-emoji" data-react="😢" data-name="Sad">😢</div>
              <div class="react-emoji" data-react="😡" data-name="Angry">😡</div>
            </div>
          </div>
          <button class="action-btn comment-btn" data-id="${p.id}">
            <i class="fa-regular fa-comment"></i>
            <span class="comment-count" data-post="${p.id}" data-n="0">0</span>
          </button>
          <button class="action-btn views-btn" style="cursor:default;">
            <i class="fa-regular fa-eye"></i>
            <span>${formatCount(viewsCount)}</span>
          </button>
          <button class="action-btn share-btn" data-url="${postUrl}">
            <i class="fa-regular fa-share-from-square"></i>
            <span>Share</span>
          </button>
        </div>
      `;

      // ====== SEE MORE / SEE LESS (event delegation) ======
      div.addEventListener("click", (e) => {
        const btn = e.target.closest(".see-more-btn");
        if (!btn) return;
        e.stopPropagation();
        const contentEl = div.querySelector(".post-content");
        const expanded = contentEl.dataset.expanded === "true";
        if (expanded) {
          contentEl.innerHTML = `${parseLinks(p.content.slice(0, POST_CONTENT_LIMIT))}… <span class="see-more-btn">See more</span>`;
          contentEl.dataset.expanded = "false";
        } else {
          contentEl.innerHTML = `${parseLinks(p.content)} <span class="see-more-btn">See less</span>`;
          contentEl.dataset.expanded = "true";
        }
      });

      // ====== REACT PANEL (Facebook style animation) ======
      const likeBtn = div.querySelector(".like-btn");
      const panel = div.querySelector(".react-panel");
      const backdrop = document.getElementById("reactionBackdrop");
      let pressTimer, panelOpen = false;

      const showPanel = () => {
        panelOpen = true;
        panel.classList.add("open");
        backdrop.classList.add("show");
        div.classList.add("reacting");
      };
      const hidePanel = () => {
        panelOpen = false;
        panel.classList.remove("open");
        backdrop.classList.remove("show");
        div.classList.remove("reacting");
      };

      // Long press on mobile / hold on desktop
      likeBtn.addEventListener("mousedown", () => { pressTimer = setTimeout(showPanel, 400); });
      likeBtn.addEventListener("touchstart", (e) => { pressTimer = setTimeout(showPanel, 500); }, { passive: true });
      likeBtn.addEventListener("mouseup", () => clearTimeout(pressTimer));
      likeBtn.addEventListener("mouseleave", () => clearTimeout(pressTimer));
      likeBtn.addEventListener("touchend", () => clearTimeout(pressTimer));
      likeBtn.addEventListener("touchmove", () => clearTimeout(pressTimer));

      // Close when click elsewhere (including the blurred backdrop)
      document.addEventListener("click", (e) => {
        if (!likeBtn.contains(e.target) && !panel.contains(e.target)) hidePanel();
      });

      // Emoji reaction click
      panel.querySelectorAll(".react-emoji").forEach(emojiEl => {
        emojiEl.innerHTML = parseEmojis(emojiEl.dataset.react);
        emojiEl.addEventListener("click", async (e) => {
          e.stopPropagation();
          const reactEmoji = emojiEl.dataset.react;
          const userLiked = JSON.parse(localStorage.getItem("xzbd_liked")||"{}");
          let n = parseInt(likeBtn.dataset.likes);
          if (!userLiked[p.id]) {
            n++;
            try { await updateDoc(doc(db,"posts",p.id), {likes: increment(1)}); } catch {}
          }
          userLiked[p.id] = reactEmoji;
          localStorage.setItem("xzbd_liked", JSON.stringify(userLiked));
          likeBtn.dataset.likes = n;
          likeBtn.innerHTML = `${parseEmojis(reactEmoji)} <span class="like-count">${formatCount(n)}</span>`;
          likeBtn.classList.add("liked");
          hidePanel();
        });
      });

      // Quick tap = toggle like
      likeBtn.addEventListener("click", async function() {
        if (panelOpen) return;
        const userLiked = JSON.parse(localStorage.getItem("xzbd_liked")||"{}");
        let n = parseInt(this.dataset.likes);
        if (userLiked[p.id]) {
          delete userLiked[p.id];
          this.classList.remove("liked");
          this.innerHTML = `<i class="fa-regular fa-thumbs-up"></i> <span class="like-count">${formatCount(Math.max(0,n-1))}</span>`;
          n = Math.max(0, n-1);
          try { await updateDoc(doc(db,"posts",p.id), {likes: increment(-1)}); } catch {}
        } else {
          userLiked[p.id] = "👍";
          this.classList.add("liked");
          this.innerHTML = `${parseEmojis("👍")} <span class="like-count">${formatCount(n+1)}</span>`;
          n++;
          try { await updateDoc(doc(db,"posts",p.id), {likes: increment(1)}); } catch {}
        }
        localStorage.setItem("xzbd_liked", JSON.stringify(userLiked));
        this.dataset.likes = n;
      });

      // Comment button
      div.querySelector(".comment-btn").addEventListener("click", function() { openCommentModal(this.dataset.id); });

      // Share button — per-post URL
      div.querySelector(".share-btn").addEventListener("click", function() {
        const url = this.dataset.url;
        openShareSheet(url);
      });

      // Load comment count
      loadComments(p.id).then(cs => {
        const el = div.querySelector(`.comment-count[data-post="${p.id}"]`);
        if (el) { el.dataset.n = cs.length; el.textContent = formatCount(cs.length); }
      });

      // ✅ Session-based view count (no duplicate per session)
      const viewed = getViewedSet();
      if (!viewed.has(p.id)) {
        markViewed(p.id);
        try { updateDoc(doc(db,"posts",p.id), {views: increment(1)}); } catch {}
      }

      if (p.video) setTimeout(()=>initVideoPlayers(div), 100);
      return div;
    }

    // ====== APPEND POSTS ======
    async function appendPosts(loadMore = false) {
      const feed = document.getElementById("postsFeed");
      const btn = document.getElementById("loadMoreBtn");
      const posts = await loadPosts(loadMore);
      if (!loadMore) feed.innerHTML = "";
      if (posts.length === 0 && !loadMore) {
        feed.innerHTML = `<div class="empty-posts">No posts yet</div>`;
      }
      posts.forEach(p => feed.appendChild(renderPost(p)));
      if (allLoaded || posts.length === 0) btn.style.display = "none";
      else btn.style.display = "flex";
      observeLazy();
    }

    function observeLazy() {
      const items = document.querySelectorAll(".lazy-item:not(.visible), .post-card:not(.visible)");
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); } });
      }, { threshold: 0.06 });
      items.forEach(i => io.observe(i));
    }

    // ====== TAB SWITCH ======
    window.switchTab = function(tab) {
      document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
      document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add("active");
      const sideCol = document.getElementById("sideCol");
      const postsSection = document.getElementById("postsSection");
      const layout = document.querySelector(".main-layout");
      if (tab === "posts") {
        postsSection.style.display=""; layout.style.gridTemplateColumns="";
        sideCol.style.display="none";
      } else if (tab === "about") {
        postsSection.style.display="none"; sideCol.style.display="";
        layout.style.gridTemplateColumns="1fr";
        document.querySelectorAll("#sideCol .tab-section").forEach(s=>s.style.display=s.dataset.section==="about"?"":"none");
        setTimeout(()=>document.querySelectorAll(".about-lazy").forEach(el=>el.classList.add("visible")),60);
      } else if (tab === "contact") {
        postsSection.style.display="none"; sideCol.style.display="";
        layout.style.gridTemplateColumns="1fr";
        document.querySelectorAll("#sideCol .tab-section").forEach(s=>s.style.display=s.dataset.section==="contact"?"":"none");
        setTimeout(()=>document.querySelectorAll(".contact-lazy").forEach(el=>el.classList.add("visible")),60);
      }
    };

    // Prevent right-click on media
    document.addEventListener("contextmenu", e => {
      if (e.target.tagName === "IMG" || e.target.tagName === "VIDEO") e.preventDefault();
    });

    // ====== INIT ======
    window.addEventListener("DOMContentLoaded", async () => {
      // Load profile (only social links + OG defaults come from here now)
      const p = await loadProfile();
      cachedProfile = p;
      renderProfile(p);

      // Remove skeleton posts
      document.getElementById("skeletonPost1")?.remove();
      document.getElementById("skeletonPost2")?.remove();
      document.getElementById("sideCol").style.display = "none";

      // Check if URL points at a single post (path-based, e.g. /postId)
      const urlPostId = getPostIdFromUrl();
      if (urlPostId) {
        // Show single post banner
        document.getElementById("singlePostBanner").style.display = "flex";

        const feed = document.getElementById("postsFeed");
        feed.innerHTML = `<div class="cmt-loading" style="padding:32px;text-align:center;color:var(--sub);">Loading post...</div>`;

        const singlePost = await loadSinglePost(urlPostId);
        feed.innerHTML = "";

        if (singlePost) {
          feed.appendChild(renderPost(singlePost));

          // Update OG meta for this specific post (for link preview)
          updateOGMeta({
            title: singlePost.content
              ? (singlePost.content.slice(0,60) + (singlePost.content.length > 60 ? "..." : "")) + " — X ZONE BD"
              : "X ZONE BD — Post",
            description: singlePost.content || "A post from X ZONE BD.",
            image: singlePost.image || PROFILE_AVATAR,
            url: buildPostUrl(urlPostId)
          });

          document.getElementById("loadMoreBtn").style.display = "none";
        } else {
          feed.innerHTML = `<div class="empty-posts">Post not found</div>`;
        }
        observeLazy();
      } else {
        // Normal feed
        await appendPosts(false);

        // Infinite scroll
        const infiniteObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => { if (entry.isIntersecting && !allLoaded) appendPosts(true); });
        }, { threshold: 0.1 });
        infiniteObserver.observe(document.getElementById("loadMoreBtn"));
      }

      // Lazy about/contact cards
      document.querySelectorAll(".about-lazy,.contact-lazy").forEach(el => {
        el.classList.add("lazy-item");
        const io = new IntersectionObserver(entries => {
          entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); } });
        }, { threshold: 0.05 });
        io.observe(el);
      });
    });
