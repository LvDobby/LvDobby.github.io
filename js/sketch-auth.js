/**
 * 生活手绘注释图 — GitHub OAuth 登录 + 纯数据库游客会话
 */
(function () {
  'use strict';

  var GUEST_STORAGE_KEY = 'sketch_guest_session';

  var supabase = null;
  /** @type {{ type: 'github', user: object } | { type: 'guest', id: string, userName: string, avatarUrl: string } | null} */
  var currentSession = null;
  var currentProfile = null;
  var readyCallbacks = [];
  var authChangeCallbacks = [];
  var authReady = false;
  var statsCache = [];

  var $loginModal, $app, $userBar, $userAvatar, $userName, $btnLogout;
  var $btnGithubLogin, $btnGuestLogin;
  var $statsList, $statsEmpty, $statsLoading;

  function $(id) {
    return document.getElementById(id);
  }

  function getConfig() {
    return window.SKETCH_CONFIG || {};
  }

  function isConfigured() {
    var cfg = getConfig();
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  }

  function isLoggedIn() {
    return !!currentSession;
  }

  function getCurrentUser() {
    if (!currentSession) return null;
    if (currentSession.type === 'github') return currentSession.user;
    return { id: currentSession.id, isGuest: true };
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

  function profileFromGitHubUser(user) {
    var meta = (user && user.user_metadata) || {};
    return {
      userName:
        meta.user_name ||
        meta.preferred_username ||
        meta.full_name ||
        meta.name ||
        (user && user.email) ||
        'GitHub User',
      avatarUrl: meta.avatar_url || meta.picture || '',
    };
  }

  function notifyReady() {
    authReady = true;
    var loggedIn = isLoggedIn();
    readyCallbacks.splice(0).forEach(function (cb) {
      try {
        cb(loggedIn);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function notifyAuthChange(loggedIn) {
    authChangeCallbacks.forEach(function (cb) {
      try {
        cb(loggedIn);
      } catch (e) {
        console.error(e);
      }
    });
  }

  function whenReady() {
    return new Promise(function (resolve) {
      if (authReady) {
        resolve(isLoggedIn());
        return;
      }
      readyCallbacks.push(resolve);
    });
  }

  function onAuthChange(cb) {
    authChangeCallbacks.push(cb);
  }

  function showLoginModal() {
    if ($loginModal) {
      $loginModal.classList.add('is-open');
      document.body.classList.add('sketch-modal-open');
    }
    resetGuestLoginButton();
    if ($btnGithubLogin) $btnGithubLogin.disabled = false;
  }

  function hideLoginModal() {
    if ($loginModal) $loginModal.classList.remove('is-open');
    document.body.classList.remove('sketch-modal-open');
  }

  function setView(loggedIn) {
    hideLoginModal();
    if (!loggedIn) showLoginModal();
    if ($app) $app.classList.toggle('is-hidden', !loggedIn);
    if ($userBar) $userBar.classList.toggle('is-hidden', !loggedIn);
  }

  function renderUserBarFromProfile(profile) {
    if (!profile || !$userBar) return;
    currentProfile = profile;
    if ($userAvatar) {
      $userAvatar.src = profile.avatarUrl || '';
      $userAvatar.alt = profile.userName;
      $userAvatar.classList.toggle('is-placeholder', !profile.avatarUrl);
    }
    if ($userName) $userName.textContent = profile.userName;
  }

  function saveGuestSession(row) {
    try {
      localStorage.setItem(
        GUEST_STORAGE_KEY,
        JSON.stringify({
          id: row.id,
          userName: row.user_name,
          avatarUrl: row.avatar_url,
          isGuest: true,
        }),
      );
    } catch (e) {
      /* ignore */
    }
  }

  function clearGuestSession() {
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function readGuestSession() {
    try {
      var raw = localStorage.getItem(GUEST_STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.id || !data.isGuest) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function activateGuestSession(data) {
    currentSession = {
      type: 'guest',
      id: data.id,
      userName: data.userName,
      avatarUrl: data.avatarUrl,
    };
    renderUserBarFromProfile({
      userName: data.userName,
      avatarUrl: data.avatarUrl,
    });
    setView(true);
  }

  function restoreGuestSession() {
    var data = readGuestSession();
    if (!data) return false;
    activateGuestSession(data);
    notifyAuthChange(true);
    return true;
  }

  function sortStats(rows) {
    return rows.slice().sort(function (a, b) {
      var diff = (b.login_count || 0) - (a.login_count || 0);
      if (diff !== 0) return diff;
      return new Date(b.last_login || 0) - new Date(a.last_login || 0);
    });
  }

  function renderStatsList(rows) {
    statsCache = sortStats(rows || []);
    if (!$statsList) return;

    if ($statsLoading) $statsLoading.classList.add('is-hidden');
    if (!statsCache.length) {
      $statsList.innerHTML = '';
      if ($statsEmpty) $statsEmpty.classList.remove('is-hidden');
      return;
    }
    if ($statsEmpty) $statsEmpty.classList.add('is-hidden');

    $statsList.innerHTML = statsCache
      .map(function (row) {
        var name = escapeHtml(row.user_name || '用户');
        var avatar = escapeHtml(row.avatar_url || '');
        var avatarHtml = avatar
          ? '<img class="sketch-stats-avatar" src="' +
            avatar +
            '" alt="' +
            name +
            '" width="40" height="40" loading="lazy">'
          : '<span class="sketch-stats-avatar sketch-stats-avatar--placeholder" aria-hidden="true">👤</span>';
        return (
          '<article class="sketch-stats-card">' +
          avatarHtml +
          '<div class="sketch-stats-body">' +
          '<div class="sketch-stats-name">' +
          name +
          '</div>' +
          '<div class="sketch-stats-meta">' +
          '<span class="sketch-stats-meta-item"><span class="sketch-stats-label">最近登录</span>' +
          formatDateTime(row.last_login) +
          '</span>' +
          '<span class="sketch-stats-meta-item"><span class="sketch-stats-label">访问</span>' +
          String(row.login_count || 0) +
          '</span>' +
          '<span class="sketch-stats-meta-item"><span class="sketch-stats-label">生成</span>' +
          String(row.draw_count || 0) +
          '</span>' +
          '</div></div></article>'
        );
      })
      .join('');
  }

  function loadUserStats() {
    if (!supabase) return Promise.resolve([]);
    if ($statsLoading) $statsLoading.classList.remove('is-hidden');
    if ($statsEmpty) $statsEmpty.classList.add('is-hidden');

    return supabase
      .from('user_stats')
      .select('id, user_name, avatar_url, first_login, last_login, login_count, draw_count, is_guest')
      .then(function (result) {
        if (result.error) throw result.error;
        renderStatsList(result.data || []);
        return result.data || [];
      })
      .catch(function (err) {
        console.error('loadUserStats', err);
        if ($statsLoading) $statsLoading.classList.add('is-hidden');
        if ($statsEmpty) {
          $statsEmpty.textContent = '统计数据加载失败，请稍后刷新';
          $statsEmpty.classList.remove('is-hidden');
        }
        return [];
      });
  }

  function recordGitHubLogin(user) {
    var profile = profileFromGitHubUser(user);
    return supabase
      .rpc('record_user_login', {
        p_user_name: profile.userName,
        p_avatar_url: profile.avatarUrl,
      })
      .then(function (result) {
        if (result.error) throw result.error;
        return loadUserStats().then(function () {
          return profile;
        });
      });
  }

  function resetGuestLoginButton() {
    if (!$btnGuestLogin) return;
    $btnGuestLogin.disabled = false;
    $btnGuestLogin.innerHTML = '<span aria-hidden="true">👤</span> 游客身份进入';
  }

  function registerGuestLogin() {
    if (!supabase) return Promise.reject(new Error('Supabase not configured'));
    return supabase.rpc('register_guest_user').then(function (result) {
      if (result.error) throw result.error;
      var row = result.data || {};
      if (!row.id) throw new Error('游客记录创建失败');
      saveGuestSession(row);
      activateGuestSession({
        id: row.id,
        userName: row.user_name,
        avatarUrl: row.avatar_url,
      });
      return loadUserStats().then(function () {
        return row;
      });
    });
  }

  function getSessionUserId() {
    if (!currentSession) return null;
    if (currentSession.type === 'guest') return currentSession.id;
    return currentSession.user && currentSession.user.id;
  }

  function incrementDrawCount() {
    if (!supabase || !currentSession) return Promise.resolve();
    var rpcPromise;
    if (currentSession.type === 'guest') {
      rpcPromise = supabase.rpc('increment_guest_draw_count', { p_id: currentSession.id });
    } else {
      rpcPromise = supabase.rpc('increment_draw_count');
    }
    return rpcPromise
      .then(function (result) {
        if (result.error) throw result.error;
        var uid = getSessionUserId();
        var idx = statsCache.findIndex(function (row) {
          return row.id === uid;
        });
        if (idx >= 0) {
          statsCache[idx].draw_count = (statsCache[idx].draw_count || 0) + 1;
          renderStatsList(statsCache);
        }
        return loadUserStats();
      })
      .catch(function (err) {
        console.error('incrementDrawCount', err);
      });
  }

  function handleGitHubSession(session, eventType) {
    var user = session && session.user;
    if (!user) {
      if (restoreGuestSession()) {
        notifyReady();
        return Promise.resolve();
      }
      currentSession = null;
      currentProfile = null;
      setView(false);
      notifyAuthChange(false);
      notifyReady();
      return Promise.resolve();
    }

    clearGuestSession();
    currentSession = { type: 'github', user: user };
    setView(true);

    if (eventType === 'SIGNED_IN') {
      return recordGitHubLogin(user)
        .then(function (profile) {
          renderUserBarFromProfile(profile);
          notifyAuthChange(true);
        })
        .catch(function (err) {
          console.error('recordGitHubLogin', err);
          renderUserBarFromProfile(profileFromGitHubUser(user));
        })
        .finally(notifyReady);
    }

    return Promise.resolve()
      .then(function () {
        renderUserBarFromProfile(profileFromGitHubUser(user));
        notifyAuthChange(true);
      })
      .finally(notifyReady);
  }

  function signInWithGitHub() {
    if (!supabase) {
      alert('未配置 Supabase，请在 _config.yml 中填写 supabase_url 与 supabase_anon_key');
      return Promise.reject(new Error('Supabase not configured'));
    }
    if ($btnGithubLogin) $btnGithubLogin.disabled = true;
    if ($btnGuestLogin) $btnGuestLogin.disabled = true;
    var redirectTo = window.location.origin + window.location.pathname;
    return supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: redirectTo },
    });
  }

  function signInAsGuest() {
    if (!supabase) {
      alert('未配置 Supabase，请在 _config.yml 中填写 supabase_url 与 supabase_anon_key');
      return Promise.reject(new Error('Supabase not configured'));
    }
    if ($btnGuestLogin) {
      $btnGuestLogin.disabled = true;
      $btnGuestLogin.textContent = '正在进入…';
    }
    if ($btnGithubLogin) $btnGithubLogin.disabled = true;

    return registerGuestLogin()
      .then(function () {
        notifyAuthChange(true);
      })
      .catch(function (err) {
        resetGuestLoginButton();
        if ($btnGithubLogin) $btnGithubLogin.disabled = false;
        alert('游客进入失败：' + (err.message || '请稍后重试'));
        throw err;
      })
      .finally(function () {
        resetGuestLoginButton();
        if ($btnGithubLogin) $btnGithubLogin.disabled = false;
        notifyReady();
      });
  }

  function signOut() {
    var done = function () {
      currentSession = null;
      currentProfile = null;
      clearGuestSession();
      setView(false);
      notifyAuthChange(false);
    };

    if (currentSession && currentSession.type === 'guest') {
      done();
      return Promise.resolve();
    }

    if (!supabase) {
      done();
      return Promise.resolve();
    }

    return supabase.auth.signOut().then(done).catch(function () {
      done();
    });
  }

  function showConfigWarning() {
    showLoginModal();
    var msg = document.querySelector('#sketch-login-modal .sketch-login-note');
    if (msg) {
      msg.textContent =
        '站点尚未配置 Supabase（supabase_url / supabase_anon_key），请在 _config.yml 中填写后重新部署。';
    }
    if ($btnGithubLogin) $btnGithubLogin.disabled = true;
    if ($btnGuestLogin) $btnGuestLogin.disabled = true;
    notifyReady();
  }

  function bindDom() {
    $loginModal = $('sketch-login-modal');
    $app = $('sketch-app');
    $userBar = $('sketch-user-bar');
    $userAvatar = $('sketch-user-avatar');
    $userName = $('sketch-user-name');
    $btnLogout = $('sketch-btn-logout');
    $btnGithubLogin = $('sketch-btn-github-login');
    $btnGuestLogin = $('sketch-btn-guest-login');
    $statsList = $('sketch-stats-list');
    $statsEmpty = $('sketch-stats-empty');
    $statsLoading = $('sketch-stats-loading');

    if ($btnGithubLogin) {
      $btnGithubLogin.addEventListener('click', signInWithGitHub);
    }
    if ($btnGuestLogin) {
      $btnGuestLogin.addEventListener('click', signInAsGuest);
    }
    if ($btnLogout) {
      $btnLogout.addEventListener('click', signOut);
    }
  }

  function initSupabase() {
    bindDom();
    showLoginModal();
    loadUserStats();

    if (!isConfigured()) {
      showConfigWarning();
      return;
    }

    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      console.error('Supabase SDK not loaded');
      showConfigWarning();
      return;
    }

    var cfg = getConfig();
    supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    supabase.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_OUT') {
        if (restoreGuestSession()) {
          notifyReady();
          return;
        }
      }
      handleGitHubSession(session, event);
    });

    supabase.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (session && session.user) {
        handleGitHubSession(session, 'INITIAL_SESSION');
        return;
      }
      if (restoreGuestSession()) {
        notifyReady();
        return;
      }
      handleGitHubSession(null, 'SIGNED_OUT');
    });
  }

  window.SketchAuth = {
    whenReady: whenReady,
    onAuthChange: onAuthChange,
    isLoggedIn: isLoggedIn,
    getCurrentUser: getCurrentUser,
    signInWithGitHub: signInWithGitHub,
    signInAsGuest: signInAsGuest,
    signOut: signOut,
    incrementDrawCount: incrementDrawCount,
    refreshStats: loadUserStats,
    isConfigured: isConfigured,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupabase);
  } else {
    initSupabase();
  }
})();
