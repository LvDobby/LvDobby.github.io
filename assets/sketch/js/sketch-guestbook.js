/**
 * 生活手绘注释图 — 侧栏访客留言（词云 + 明细）
 */
(function () {
  'use strict';

  var GUEST_AVATAR_URL =
    'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';

  var STOP_WORDS = {
    的: 1,
    了: 1,
    是: 1,
    在: 1,
    我: 1,
    有: 1,
    和: 1,
    就: 1,
    不: 1,
    人: 1,
    都: 1,
    一: 1,
    一个: 1,
    上: 1,
    也: 1,
    很: 1,
    到: 1,
    说: 1,
    要: 1,
    去: 1,
    你: 1,
    会: 1,
    着: 1,
    没有: 1,
    看: 1,
    好: 1,
    自己: 1,
    这: 1,
    那: 1,
    吗: 1,
    吧: 1,
    啊: 1,
    呢: 1,
    哦: 1,
    嗯: 1,
    哈: 1,
    什么: 1,
    怎么: 1,
    可以: 1,
    这个: 1,
    那个: 1,
    就是: 1,
    觉得: 1,
    一下: 1,
    真的: 1,
    还是: 1,
    我们: 1,
    你们: 1,
    他们: 1,
    不是: 1,
    可能: 1,
    已经: 1,
    非常: 1,
    比较: 1,
    感觉: 1,
    希望: 1,
    谢谢: 1,
  };

  var KEYWORD_PALETTE = [
    { bg: 'hsla(210, 22%, 90%, 0.98)', fg: 'hsl(210, 26%, 40%)' },
    { bg: 'hsla(168, 20%, 89%, 0.98)', fg: 'hsl(168, 24%, 36%)' },
    { bg: 'hsla(32, 24%, 90%, 0.98)', fg: 'hsl(32, 28%, 42%)' },
    { bg: 'hsla(340, 18%, 91%, 0.98)', fg: 'hsl(340, 22%, 42%)' },
    { bg: 'hsla(268, 20%, 91%, 0.98)', fg: 'hsl(268, 24%, 44%)' },
    { bg: 'hsla(192, 18%, 89%, 0.98)', fg: 'hsl(192, 22%, 38%)' },
    { bg: 'hsla(82, 18%, 90%, 0.98)', fg: 'hsl(82, 22%, 38%)' },
    { bg: 'hsla(12, 22%, 91%, 0.98)', fg: 'hsl(12, 26%, 42%)' },
    { bg: 'hsla(228, 16%, 91%, 0.98)', fg: 'hsl(228, 20%, 44%)' },
    { bg: 'hsla(145, 18%, 89%, 0.98)', fg: 'hsl(145, 22%, 38%)' },
    { bg: 'hsla(48, 20%, 90%, 0.98)', fg: 'hsl(48, 24%, 40%)' },
    { bg: 'hsla(300, 16%, 91%, 0.98)', fg: 'hsl(300, 20%, 42%)' },
  ];

  var guestbookCache = [];
  var keywordColorCache = {};
  var detailsVisible = false;

  var $cloud, $cloudEmpty, $cloudLoading, $details, $toggleDetails;
  var $modal, $input, $btnCompose, $btnSubmit, $btnCancel, $backdrop;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      ' ' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  function isGuestUserName(name) {
    return /^游客\d+$/.test(String(name || ''));
  }

  function normalizeAvatarUrl(url, userName) {
    var resolved = String(url || '').trim();
    if ((isGuestUserName(userName) || !resolved) && resolved.indexOf('github.com/identicons/') !== -1) {
      return GUEST_AVATAR_URL;
    }
    if (isGuestUserName(userName) && !resolved) return GUEST_AVATAR_URL;
    return resolved;
  }

  function getClient() {
    return window.SketchAuth && window.SketchAuth.getClient ? window.SketchAuth.getClient() : null;
  }

  function getProfile() {
    if (window.SketchAuth && window.SketchAuth.getProfile) {
      return window.SketchAuth.getProfile();
    }
    return { userName: '', avatarUrl: '' };
  }

  function isValidKeyword(word) {
    word = String(word || '').trim();
    if (word.length < 2 || word.length > 12) return false;
    if (STOP_WORDS[word]) return false;
    if (/^\d+$/.test(word)) return false;
    return true;
  }

  /** 每条留言抽取一个关键词（完整词组，非单字或 n-gram 碎片） */
  function pickKeyword(text) {
    var raw = String(text || '').trim();
    if (!raw) return '留言';

    var candidates = [];
    var parts = raw.split(/[\s,，。！？；;、\.!\?\(\)（）\[\]【】「」"'‘’“”\/\\|｜]+/);

    function pushCandidate(word, score) {
      if (!isValidKeyword(word)) return;
      candidates.push({ word: word, score: score });
    }

    parts.forEach(function (part, partIndex) {
      part = part.trim();
      if (!part) return;

      if (isValidKeyword(part)) {
        pushCandidate(part, part.length * 10 + (parts.length - partIndex));
      }

      var cnRuns = part.match(/[\u4e00-\u9fff]+/g) || [];
      cnRuns.forEach(function (run) {
        if (run.length <= 6) {
          pushCandidate(run, run.length * 10 + 5);
          return;
        }
        for (var len = 4; len >= 2; len -= 1) {
          var head = run.slice(0, len);
          if (isValidKeyword(head)) {
            pushCandidate(head, len * 10 + 3);
            break;
          }
        }
      });

      var enWords = part.match(/[a-zA-Z][a-zA-Z0-9_-]{2,11}/g) || [];
      enWords.forEach(function (w) {
        pushCandidate(w, w.length * 8);
      });
    });

    if (candidates.length) {
      candidates.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return b.word.length - a.word.length;
      });
      return candidates[0].word;
    }

    var cn = raw.match(/[\u4e00-\u9fff]{2,4}/);
    if (cn) return cn[0];

    var trimmed = raw.replace(/\s+/g, '');
    if (trimmed.length >= 2) return trimmed.slice(0, 4);
    return '留言';
  }

  function hashWord(word) {
    var h = 0;
    var str = String(word || '');
    for (var i = 0; i < str.length; i += 1) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function getKeywordStyle(word) {
    if (!keywordColorCache[word]) {
      keywordColorCache[word] = KEYWORD_PALETTE[hashWord(word) % KEYWORD_PALETTE.length];
    }
    return keywordColorCache[word];
  }

  function buildEntryKeywords(entries) {
    return (entries || []).map(function (row) {
      var word = pickKeyword(row.content);
      return {
        word: word,
        style: getKeywordStyle(word),
        row: row,
      };
    });
  }

  function keywordTagHtml(word, style, extraClass) {
    var cls = 'sketch-guestbook-kw-tag' + (extraClass ? ' ' + extraClass : '');
    return (
      '<span class="' +
      cls +
      '" style="color:' +
      style.fg +
      ';background:' +
      style.bg +
      '">' +
      escapeHtml(word) +
      '</span>'
    );
  }

  function renderKeywordCloud(items) {
    if (!$cloud) return;
    $cloud.innerHTML = '';

    if (!items.length) {
      if ($cloudEmpty) {
        $cloudEmpty.textContent = guestbookCache.length
          ? '留言已收录，暂未提取到关键词'
          : '暂无留言，来做第一个留言的人吧';
        $cloudEmpty.classList.remove('is-hidden');
      }
      return;
    }
    if ($cloudEmpty) $cloudEmpty.classList.add('is-hidden');

    var total = items.length;
    var fontSize = Math.max(10, Math.min(15, Math.round(17 - total * 0.12)));

    items.forEach(function (item, index) {
      var rank = total > 1 ? index / (total - 1) : 0;
      var angle = ((index * 137.508) % 360) * (Math.PI / 180);
      var radius = rank * 40 + (index % 3) * 2;
      var x = 50 + Math.cos(angle) * radius;
      var y = 50 + Math.sin(angle) * radius;
      x = Math.max(10, Math.min(90, x));
      y = Math.max(14, Math.min(86, y));

      var span = document.createElement('span');
      span.className = 'sketch-guestbook-kw';
      span.textContent = item.word;
      span.style.left = x + '%';
      span.style.top = y + '%';
      span.style.fontSize = fontSize + 'px';
      span.style.color = item.style.fg;
      span.style.backgroundColor = item.style.bg;
      span.style.zIndex = String(total - index);
      span.title =
        (item.row.user_name || '用户') +
        ' · ' +
        formatDateTime(item.row.created_at) +
        '：' +
        item.word;
      $cloud.appendChild(span);
    });
  }

  function renderGuestbookDetails(rows) {
    if (!$details) return;

    if (!rows.length) {
      $details.innerHTML = '<p class="sketch-guestbook-hint">暂无留言明细</p>';
      return;
    }

    $details.innerHTML = rows
      .map(function (row) {
        var name = escapeHtml(row.user_name || '用户');
        var avatar = escapeHtml(normalizeAvatarUrl(row.avatar_url, row.user_name));
        var content = escapeHtml(row.content || '');
        var keyword = pickKeyword(row.content);
        var kwStyle = getKeywordStyle(keyword);
        var avatarHtml = avatar
          ? '<img class="sketch-guestbook-detail-avatar" src="' +
            avatar +
            '" alt="' +
            name +
            '" width="32" height="32" loading="lazy">'
          : '<span class="sketch-guestbook-detail-avatar sketch-guestbook-detail-avatar--placeholder" aria-hidden="true">👤</span>';
        return (
          '<article class="sketch-guestbook-detail-item">' +
          avatarHtml +
          '<div class="sketch-guestbook-detail-body">' +
          '<div class="sketch-guestbook-detail-head">' +
          '<div class="sketch-guestbook-detail-name">' +
          name +
          '</div>' +
          keywordTagHtml(keyword, kwStyle, 'sketch-guestbook-detail-kw') +
          '</div>' +
          '<div class="sketch-guestbook-detail-time">' +
          formatDateTime(row.created_at) +
          '</div>' +
          '<div class="sketch-guestbook-detail-text" title="' +
          content +
          '">' +
          content +
          '</div>' +
          '</div></article>'
        );
      })
      .join('');
  }

  function loadGuestbook() {
    var client = getClient();
    if (!client) return Promise.resolve([]);
    if ($cloudLoading) $cloudLoading.classList.remove('is-hidden');
    if ($cloudEmpty) $cloudEmpty.classList.add('is-hidden');

    return client
      .from('page_guestbook')
      .select('id, user_id, user_name, avatar_url, content, created_at')
      .order('created_at', { ascending: false })
      .then(function (result) {
        if (result.error) throw result.error;
        guestbookCache = result.data || [];
        keywordColorCache = {};
        if ($cloudLoading) $cloudLoading.classList.add('is-hidden');
        renderKeywordCloud(buildEntryKeywords(guestbookCache));
        if (detailsVisible) renderGuestbookDetails(guestbookCache);
        return guestbookCache;
      })
      .catch(function (err) {
        console.error('loadGuestbook', err);
        if ($cloudLoading) $cloudLoading.classList.add('is-hidden');
        if ($cloudEmpty) {
          $cloudEmpty.textContent = '留言加载失败，请稍后刷新';
          $cloudEmpty.classList.remove('is-hidden');
        }
        return [];
      });
  }

  function openModal() {
    if (!window.SketchAuth || !window.SketchAuth.isLoggedIn()) {
      alert('请先登录后再留言（GitHub 或游客身份均可）');
      if (window.SketchAuth && window.SketchAuth.promptLogin) {
        window.SketchAuth.promptLogin();
      }
      return;
    }
    if ($modal) $modal.classList.remove('is-hidden');
    if ($input) {
      $input.value = '';
      $input.focus();
    }
    document.body.classList.add('sketch-guestbook-modal-open');
  }

  function closeModal() {
    if ($modal) $modal.classList.add('is-hidden');
    document.body.classList.remove('sketch-guestbook-modal-open');
  }

  function submitGuestbook() {
    var client = getClient();
    if (!client || !window.SketchAuth || !window.SketchAuth.isLoggedIn()) {
      alert('请先登录后再留言');
      return Promise.reject(new Error('Not logged in'));
    }

    var content = $input ? $input.value.trim() : '';
    if (!content) {
      alert('请输入留言内容');
      return Promise.reject(new Error('Empty'));
    }
    if (content.length > 500) {
      alert('留言不能超过 500 字');
      return Promise.reject(new Error('Too long'));
    }

    var profile = getProfile();
    var session = window.SketchAuth.getSession ? window.SketchAuth.getSession() : null;
    var rpcPromise;

    if ($btnSubmit) {
      $btnSubmit.disabled = true;
      $btnSubmit.textContent = '发布中…';
    }

    if (session && session.type === 'guest') {
      rpcPromise = client.rpc('record_guest_page_guestbook', {
        p_id: session.id,
        p_content: content,
        p_user_name: profile.userName,
        p_avatar_url: profile.avatarUrl || GUEST_AVATAR_URL,
      });
    } else {
      rpcPromise = client.rpc('record_page_guestbook', {
        p_content: content,
        p_user_name: profile.userName,
        p_avatar_url: profile.avatarUrl,
      });
    }

    return rpcPromise
      .then(function (result) {
        if (result.error) throw result.error;
        closeModal();
        return loadGuestbook();
      })
      .catch(function (err) {
        console.error('submitGuestbook', err);
        alert('留言失败：' + (err.message || '请稍后重试'));
      })
      .finally(function () {
        if ($btnSubmit) {
          $btnSubmit.disabled = false;
          $btnSubmit.textContent = '发布留言';
        }
      });
  }

  function toggleDetails() {
    detailsVisible = !detailsVisible;
    if ($details) $details.classList.toggle('is-hidden', !detailsVisible);
    if ($toggleDetails) {
      $toggleDetails.textContent = detailsVisible ? '隐藏留言明细' : '显示留言明细';
      $toggleDetails.setAttribute('aria-expanded', detailsVisible ? 'true' : 'false');
    }
    if (detailsVisible) renderGuestbookDetails(guestbookCache);
  }

  function bindDom() {
    $cloud = $('sketch-guestbook-cloud');
    $cloudEmpty = $('sketch-guestbook-cloud-empty');
    $cloudLoading = $('sketch-guestbook-cloud-loading');
    $details = $('sketch-guestbook-details');
    $toggleDetails = $('sketch-guestbook-toggle-details');
    $modal = $('sketch-guestbook-modal');
    $input = $('sketch-guestbook-input');
    $btnCompose = $('sketch-btn-guestbook');
    $btnSubmit = $('sketch-guestbook-submit');
    $btnCancel = $('sketch-guestbook-cancel');
    $backdrop = document.querySelector('#sketch-guestbook-modal .sketch-guestbook-modal-backdrop');

    if (!$cloud) return false;

    if ($btnCompose) $btnCompose.addEventListener('click', openModal);
    if ($btnCancel) $btnCancel.addEventListener('click', closeModal);
    if ($backdrop) $backdrop.addEventListener('click', closeModal);
    if ($btnSubmit) $btnSubmit.addEventListener('click', submitGuestbook);
    if ($toggleDetails) $toggleDetails.addEventListener('click', toggleDetails);

    if ($modal) {
      $modal.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal();
      });
    }

    return true;
  }

  function init() {
    if (!bindDom()) return;

    function start() {
      loadGuestbook();
    }

    if (window.SketchAuth && window.SketchAuth.whenReady) {
      window.SketchAuth.whenReady().then(start);
      if (window.SketchAuth.onAuthChange) {
        window.SketchAuth.onAuthChange(function () {
          /* 登录状态变化不影响已加载留言 */
        });
      }
    } else {
      start();
    }
  }

  window.SketchGuestbook = {
    refresh: loadGuestbook,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
