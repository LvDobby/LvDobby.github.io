/**
 * 生活手绘注释图 — 侧栏访客留言（词云 + 明细）
 */
(function () {
  'use strict';

  var GUEST_AVATAR_URL = '/img/favicon.ico';

  var DISPLAY_MAX_LEN = 10;

  var KEYWORD_PALETTE = [
    { bg: 'hsla(210, 18%, 91%, 0.98)', fg: 'hsl(210, 22%, 40%)' },
    { bg: 'hsla(168, 16%, 90%, 0.98)', fg: 'hsl(168, 20%, 36%)' },
    { bg: 'hsla(32, 18%, 91%, 0.98)', fg: 'hsl(32, 22%, 42%)' },
    { bg: 'hsla(340, 14%, 91%, 0.98)', fg: 'hsl(340, 18%, 42%)' },
    { bg: 'hsla(268, 16%, 91%, 0.98)', fg: 'hsl(268, 20%, 44%)' },
    { bg: 'hsla(192, 14%, 90%, 0.98)', fg: 'hsl(192, 18%, 38%)' },
    { bg: 'hsla(82, 14%, 90%, 0.98)', fg: 'hsl(82, 18%, 38%)' },
    { bg: 'hsla(12, 16%, 91%, 0.98)', fg: 'hsl(12, 20%, 42%)' },
    { bg: 'hsla(228, 12%, 91%, 0.98)', fg: 'hsl(228, 16%, 44%)' },
    { bg: 'hsla(145, 14%, 90%, 0.98)', fg: 'hsl(145, 18%, 38%)' },
    { bg: 'hsla(48, 16%, 91%, 0.98)', fg: 'hsl(48, 20%, 40%)' },
    { bg: 'hsla(300, 12%, 91%, 0.98)', fg: 'hsl(300, 16%, 42%)' },
    { bg: 'hsla(175, 14%, 90%, 0.98)', fg: 'hsl(175, 18%, 38%)' },
    { bg: 'hsla(20, 14%, 91%, 0.98)', fg: 'hsl(20, 18%, 42%)' },
    { bg: 'hsla(250, 12%, 91%, 0.98)', fg: 'hsl(250, 16%, 44%)' },
    { bg: 'hsla(118, 14%, 90%, 0.98)', fg: 'hsl(118, 18%, 38%)' },
  ];

  var guestbookCache = [];
  var guestbookKeywordItems = [];
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

  /** 留言正文规范化（合并空白，保留整体内容） */
  function normalizeGuestbookText(text) {
    return String(text || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /** 词云/标签展示：整体输出，超过 10 字截断并省略 */
  function formatGuestbookDisplayText(text) {
    var raw = normalizeGuestbookText(text);
    if (!raw) return '留言';
    var chars = Array.from(raw);
    if (chars.length <= DISPLAY_MAX_LEN) return raw;
    return chars.slice(0, DISPLAY_MAX_LEN).join('') + '…';
  }

  function makeDistinctStyle(index, total) {
    if (total <= KEYWORD_PALETTE.length) {
      return KEYWORD_PALETTE[index % KEYWORD_PALETTE.length];
    }
    var hue = Math.round((index * 137.508 + 18) % 360);
    return {
      bg: 'hsla(' + hue + ', 14%, 91%, 0.98)',
      fg: 'hsl(' + hue + ', 18%, 40%)',
    };
  }

  function sortEntriesByTime(entries) {
    return (entries || []).slice().sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }

  function buildEntryKeywords(entries) {
    var list = sortEntriesByTime(entries);
    var total = list.length;
    return list.map(function (row, index) {
      var fullText = normalizeGuestbookText(row.content) || '留言';
      return {
        word: formatGuestbookDisplayText(row.content),
        fullText: fullText,
        style: makeDistinctStyle(index, total),
        row: row,
        timeIndex: index,
      };
    });
  }

  function findKeywordItem(rowId) {
    for (var i = 0; i < guestbookKeywordItems.length; i += 1) {
      if (guestbookKeywordItems[i].row.id === rowId) return guestbookKeywordItems[i];
    }
    return null;
  }

  function keywordTagHtml(word, style, extraClass, fullText) {
    var cls = 'sketch-guestbook-kw-tag' + (extraClass ? ' ' + extraClass : '');
    var titleAttr = fullText && fullText !== word ? ' title="' + escapeHtml(fullText) + '"' : '';
    return (
      '<span class="' +
      cls +
      '"' +
      titleAttr +
      ' style="color:' +
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
          ? '留言已收录，暂无可展示内容'
          : '暂无留言，来做第一个留言的人吧';
        $cloudEmpty.classList.remove('is-hidden');
      }
      return;
    }
    if ($cloudEmpty) $cloudEmpty.classList.add('is-hidden');

    var total = items.length;
    var maxFont = 18;
    var minFont = 10;

    items.forEach(function (item, index) {
      var timeRank = total > 1 ? index / (total - 1) : 0;
      var fontSize = Math.round(maxFont - timeRank * (maxFont - minFont));

      var x = 50;
      var y = 50;
      if (index > 0) {
        var angle = ((index * 137.508) % 360) * (Math.PI / 180);
        var radiusPct = 8 + timeRank * 36;
        x = 50 + Math.cos(angle) * radiusPct;
        y = 50 + Math.sin(angle) * radiusPct;
        x = Math.max(8, Math.min(92, x));
        y = Math.max(12, Math.min(88, y));
      }

      var span = document.createElement('span');
      span.className = 'sketch-guestbook-kw' + (index === 0 ? ' is-latest' : '');
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
        (item.fullText || item.word);
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
        var keywordItem = findKeywordItem(row.id) || {
          word: formatGuestbookDisplayText(row.content),
          fullText: normalizeGuestbookText(row.content) || '留言',
          style: makeDistinctStyle(0, 1),
        };
        var keyword = keywordItem.word;
        var kwStyle = keywordItem.style;
        var kwFull = keywordItem.fullText;
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
          keywordTagHtml(keyword, kwStyle, 'sketch-guestbook-detail-kw', kwFull) +
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
        guestbookKeywordItems = buildEntryKeywords(guestbookCache);
        if ($cloudLoading) $cloudLoading.classList.add('is-hidden');
        renderKeywordCloud(guestbookKeywordItems);
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
