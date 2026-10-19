// Process-family observer. Build against the installed macOS SDK; no ABI offsets are copied into this source.
#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  pid_t pid;
  uint64_t start_sec;
  uint64_t start_usec;
} identity;

typedef struct {
  identity id;
  pid_t ppid;
  int inclusion;
} process;

static volatile sig_atomic_t interrupted = 0;
static process *table;
static size_t count;
static size_t *slots;
static size_t slot_count;
static identity *known;
static size_t known_count;
static size_t known_capacity;
static size_t *known_slots;
static size_t known_slot_count;
static identity root;
static bool root_observed;
static pid_t launched_child = -1;
static bool child_reaped;
static FILE *report_file;
static uint64_t now_ns(void);
static void terminal_identities(size_t *surviving, size_t *uncertain);
static void cleanup_known(void);
static void print_identity_status(FILE *output, size_t *surviving, size_t *uncertain);

static void failure(const char *reason) {
  if (launched_child > 0 && !child_reaped) {
    // An unreaped direct child still owns its PID. This never signals a looked-up or reused PID.
    kill(launched_child, SIGKILL);
    uint64_t deadline = now_ns() + 5000000000ULL;
    while (now_ns() < deadline) {
      if (waitpid(launched_child, NULL, WNOHANG) == launched_child) { child_reaped = true; break; }
      struct timespec pause = {0, 10000000L};
      nanosleep(&pause, NULL);
    }
  }
  cleanup_known();
  if (report_file != NULL) {
    fprintf(report_file, "{\"type\":\"result\",\"success\":false,\"uncertainFamily\":true,\"error\":\"%s\",", reason);
    size_t surviving, uncertain;
    print_identity_status(report_file, &surviving, &uncertain);
    fputs("}\n", report_file);
    fflush(report_file);
  }
  fprintf(stderr, "observer failure: %s\n", reason);
  exit(2);
}

static void on_signal(int signal_number) { interrupted = signal_number; }

static uint64_t now_ns(void) {
  struct timespec time;
  clock_gettime(CLOCK_MONOTONIC, &time);
  return (uint64_t)time.tv_sec * 1000000000ULL + (uint64_t)time.tv_nsec;
}

static bool equal(identity a, identity b) {
  return a.pid == b.pid && a.start_sec == b.start_sec && a.start_usec == b.start_usec;
}

static size_t lookup(pid_t pid) {
  size_t slot = ((uint32_t)pid * 2654435761U) & (slot_count - 1);
  while (slots[slot] != 0) {
    size_t index = slots[slot] - 1;
    if (table[index].id.pid == pid) return index;
    slot = (slot + 1) & (slot_count - 1);
  }
  return SIZE_MAX;
}

static bool was_known(identity id) {
  if (known_slot_count == 0) return false;
  uint64_t hash = (uint64_t)(uint32_t)id.pid * 11400714819323198485ULL ^ id.start_sec ^ (id.start_usec << 17);
  size_t slot = (size_t)hash & (known_slot_count - 1);
  while (known_slots[slot] != 0) {
    if (equal(id, known[known_slots[slot] - 1])) return true;
    slot = (slot + 1) & (known_slot_count - 1);
  }
  return false;
}

static bool include(size_t index) {
  process *item = &table[index];
  if (item->inclusion == 2) return true;
  if (item->inclusion == 3 || item->inclusion == 1) return false;
  item->inclusion = 1;
  bool owned = equal(item->id, root) || was_known(item->id);
  if (!owned && item->ppid > 0 && item->ppid != item->id.pid) {
    size_t parent = lookup(item->ppid);
    if (parent != SIZE_MAX) owned = include(parent);
  }
  item->inclusion = owned ? 2 : 3;
  return owned;
}

static void remember(identity id) {
  if (was_known(id)) return;
  if (known_count == known_capacity) {
    known_capacity = known_capacity == 0 ? 16 : known_capacity * 2;
    identity *grown = realloc(known, known_capacity * sizeof(*known));
    if (grown == NULL) failure("realloc known");
    known = grown;
  }
  if ((known_count + 1) * 2 >= known_slot_count) {
    size_t new_count = known_slot_count == 0 ? 32 : known_slot_count * 2;
    size_t *grown = calloc(new_count, sizeof(*grown));
    if (grown == NULL) failure("calloc known map");
    for (size_t i = 0; i < known_count; i++) {
      identity previous = known[i];
      uint64_t hash = (uint64_t)(uint32_t)previous.pid * 11400714819323198485ULL ^ previous.start_sec ^ (previous.start_usec << 17);
      size_t slot = (size_t)hash & (new_count - 1);
      while (grown[slot] != 0) slot = (slot + 1) & (new_count - 1);
      grown[slot] = i + 1;
    }
    free(known_slots);
    known_slots = grown;
    known_slot_count = new_count;
  }
  uint64_t hash = (uint64_t)(uint32_t)id.pid * 11400714819323198485ULL ^ id.start_sec ^ (id.start_usec << 17);
  size_t slot = (size_t)hash & (known_slot_count - 1);
  while (known_slots[slot] != 0) slot = (slot + 1) & (known_slot_count - 1);
  known_slots[slot] = known_count + 1;
  known[known_count++] = id;
}

static bool bsd_identity(pid_t pid, struct proc_bsdinfo *info) {
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, info, sizeof(*info)) == sizeof(*info);
}

// Checking a PID and signaling it are separate syscalls. This bounds the risk but is not an atomic PID identity handle.
static void signal_known(int signal_number) {
  for (size_t i = 0; i < known_count; i++) {
    if (equal(known[i], root) && child_reaped) continue;
    struct proc_bsdinfo info;
    if (!bsd_identity(known[i].pid, &info)) continue;
    identity current = {known[i].pid, info.pbi_start_tvsec, info.pbi_start_tvusec};
    if (equal(current, known[i])) kill(known[i].pid, signal_number);
  }
}

static void cleanup_known(void) {
  if (known_count == 0) return;
  signal_known(SIGTERM);
  uint64_t deadline = now_ns() + 1000000000ULL;
  while (now_ns() < deadline) {
    size_t surviving, uncertain;
    terminal_identities(&surviving, &uncertain);
    if (surviving == 0) break;
    struct timespec pause = {0, 25000000L};
    nanosleep(&pause, NULL);
  }
  signal_known(SIGKILL);
  deadline = now_ns() + 2000000000ULL;
  while (now_ns() < deadline) {
    size_t surviving, uncertain;
    terminal_identities(&surviving, &uncertain);
    if (surviving == 0) break;
    struct timespec pause = {0, 25000000L};
    nanosleep(&pause, NULL);
  }
}

static void terminal_identities(size_t *surviving, size_t *uncertain) {
  *surviving = 0;
  *uncertain = 0;
  for (size_t i = 0; i < known_count; i++) {
    struct proc_bsdinfo info;
    errno = 0;
    if (bsd_identity(known[i].pid, &info)) {
      identity current = {known[i].pid, info.pbi_start_tvsec, info.pbi_start_tvusec};
      if (equal(known[i], current)) (*surviving)++;
    } else if (errno != ESRCH) {
      (*uncertain)++;
    }
  }
}

static void print_identity_status(FILE *output, size_t *surviving, size_t *uncertain) {
  *surviving = 0;
  *uncertain = 0;
  fputs("\"remainingIdentities\":[", output);
  bool first = true;
  for (size_t i = 0; i < known_count; i++) {
    struct proc_bsdinfo info;
    errno = 0;
    const char *state = NULL;
    if (bsd_identity(known[i].pid, &info)) {
      identity current = {known[i].pid, info.pbi_start_tvsec, info.pbi_start_tvusec};
      if (equal(known[i], current)) { state = "surviving"; (*surviving)++; }
    } else if (errno != ESRCH) {
      state = "unreadable";
      (*uncertain)++;
    }
    if (state == NULL) continue;
    if (!first) fputc(',', output);
    first = false;
    fprintf(output, "{\"pid\":%d,\"startSec\":%" PRIu64 ",\"startUsec\":%" PRIu64 ",\"state\":\"%s\"}", known[i].pid, known[i].start_sec, known[i].start_usec, state);
  }
  fprintf(output, "],\"survivingProcesses\":%zu,\"uncertainIdentities\":%zu,\"terminalIdentityCheckComplete\":%s", *surviving, *uncertain, *uncertain == 0 ? "true" : "false");
}

static void sample(FILE *output, unsigned sweep, bool *complete, uint64_t *sum, size_t *live) {
  uint64_t started = now_ns();
  int capacity = 4096;
  pid_t *pids = NULL;
  int bytes;
  do {
    capacity *= 2;
    pid_t *grown = realloc(pids, (size_t)capacity * sizeof(*pids));
    if (grown == NULL) failure("realloc pids");
    pids = grown;
    bytes = proc_listpids(PROC_ALL_PIDS, 0, pids, capacity * (int)sizeof(*pids));
  } while (bytes >= capacity * (int)sizeof(*pids));
  if (bytes <= 0) failure("proc_listpids");
  free(table);
  count = 0;
  table = calloc((size_t)bytes / sizeof(*pids), sizeof(*table));
  if (table == NULL) failure("calloc process table");
  for (int i = 0; i < bytes / (int)sizeof(*pids); i++) {
    if (pids[i] <= 0) continue;
    struct proc_bsdinfo info;
    if (!bsd_identity(pids[i], &info)) continue;
    table[count].id = (identity){pids[i], info.pbi_start_tvsec, info.pbi_start_tvusec};
    table[count].ppid = (pid_t)info.pbi_ppid;
    count++;
  }
  free(pids);
  free(slots);
  slot_count = 1;
  while (slot_count < count * 4 + 1) slot_count *= 2;
  slots = calloc(slot_count, sizeof(*slots));
  if (slots == NULL) failure("calloc pid map");
  for (size_t i = 0; i < count; i++) {
    size_t slot = ((uint32_t)table[i].id.pid * 2654435761U) & (slot_count - 1);
    while (slots[slot] != 0) slot = (slot + 1) & (slot_count - 1);
    slots[slot] = i + 1;
  }
  *complete = true;
  *sum = 0;
  *live = 0;
  fprintf(output, "{\"type\":\"sweep\",\"index\":%u,\"startedMonotonicNs\":%" PRIu64 ",\"processes\":[", sweep, started);
  bool first = true;
  for (size_t i = 0; i < count; i++) {
    if (!include(i)) continue;
    process item = table[i];
    if (equal(item.id, root)) root_observed = true;
    (*live)++;
    remember(item.id);
    struct rusage_info_v4 usage;
    struct proc_bsdinfo after;
    uint64_t at = now_ns();
    bool measured = proc_pid_rusage(item.id.pid, RUSAGE_INFO_V4, (rusage_info_t *)&usage) == 0;
    measured = measured && bsd_identity(item.id.pid, &after) &&
      item.id.start_sec == after.pbi_start_tvsec && item.id.start_usec == after.pbi_start_tvusec;
    if (!first) fputc(',', output);
    first = false;
    fprintf(output, "{\"pid\":%d,\"ppid\":%d,\"startSec\":%" PRIu64 ",\"startUsec\":%" PRIu64 ",\"sampleMonotonicNs\":%" PRIu64 ",\"physicalFootprintBytes\":", item.id.pid, item.ppid, item.id.start_sec, item.id.start_usec, at);
    if (measured) {
      fprintf(output, "%" PRIu64, usage.ri_phys_footprint);
      if (UINT64_MAX - *sum < usage.ri_phys_footprint) { *complete = false; }
      else *sum += usage.ri_phys_footprint;
    } else {
      fputs("null", output);
      *complete = false;
    }
    fputc('}', output);
  }
  for (size_t i = 0; i < known_count; i++) {
    size_t index = lookup(known[i].pid);
    if (index != SIZE_MAX && equal(table[index].id, known[i])) continue;
    struct proc_bsdinfo identity_check;
    errno = 0;
    if (bsd_identity(known[i].pid, &identity_check)) {
      identity current = {known[i].pid, identity_check.pbi_start_tvsec, identity_check.pbi_start_tvusec};
      if (equal(known[i], current)) *complete = false;
    } else if (errno != ESRCH) {
      *complete = false;
    }
  }
  fprintf(output, "],\"endedMonotonicNs\":%" PRIu64 ",\"complete\":%s,\"observedSumBytes\":%" PRIu64 "}\n", now_ns(), *complete ? "true" : "false", *sum);
  fflush(output);
}

int main(int argc, char **argv) {
  if (argc < 6 || strcmp(argv[4], "--") != 0) {
    fputs("usage: darwin-family-footprint OUTPUT INTERVAL_MS MAX_MS -- COMMAND [ARGS...]\n", stderr);
    return 2;
  }
  char *end;
  long interval = strtol(argv[2], &end, 10);
  if (*end != '\0' || interval < 25 || interval > 1000) { fputs("interval must be 25..1000 ms\n", stderr); return 2; }
  long max_ms = strtol(argv[3], &end, 10);
  if (*end != '\0' || max_ms < 1000 || max_ms > 900000) { fputs("max duration must be 1000..900000 ms\n", stderr); return 2; }
  FILE *output = fopen(argv[1], "w");
  if (output == NULL) { perror("fopen output"); return 2; }
  report_file = output;
  pid_t child = fork();
  if (child < 0) failure("fork");
  if (child == 0) {
    setpgid(0, 0);
    execvp(argv[5], argv + 5);
    perror("execvp");
    _exit(127);
  }
  launched_child = child;
  setpgid(child, child);
  struct proc_bsdinfo initial;
  if (!bsd_identity(child, &initial)) failure("failed to authenticate direct child identity");
  root = (identity){child, initial.pbi_start_tvsec, initial.pbi_start_tvusec};
  remember(root);
  signal(SIGINT, on_signal);
  signal(SIGTERM, on_signal);
  bool complete;
  uint64_t sum, maximum = 0;
  size_t live;
  unsigned sweeps = 0, complete_sweeps = 0;
  int status = 0;
  bool exited = false;
  bool terminating = false;
  bool timed_out = false;
  uint64_t deadline = now_ns() + (uint64_t)max_ms * 1000000ULL;
  uint64_t terminate_at = 0;
  do {
    sample(output, sweeps++, &complete, &sum, &live);
    if (complete) { complete_sweeps++; if (sum > maximum) maximum = sum; }
    if (!terminating && (interrupted || now_ns() >= deadline)) {
      timed_out = !interrupted;
      terminating = true;
      terminate_at = now_ns();
      // An unreaped direct child still owns its PID, even if its proc identity is unreadable.
      kill(child, SIGTERM);
    } else if (terminating && now_ns() - terminate_at >= 3000000000ULL) {
      kill(child, SIGKILL);
    }
    pid_t result = waitpid(child, &status, WNOHANG);
    if (result == child) { exited = true; child_reaped = true; }
    else if (result < 0) { child_reaped = true; failure("waitpid"); }
    if (!exited && terminating && now_ns() - terminate_at >= 5000000000ULL) failure("child did not exit within bounded shutdown");
    if (!exited) {
      struct timespec pause = {interval / 1000, (interval % 1000) * 1000000L};
      nanosleep(&pause, NULL);
    }
  } while (!exited);
  // A terminal sweep plus direct identity checks distinguish gone from unreadable descendants.
  sample(output, sweeps++, &complete, &sum, &live);
  if (complete) { complete_sweeps++; if (sum > maximum) maximum = sum; }
  size_t before_surviving, before_uncertain;
  terminal_identities(&before_surviving, &before_uncertain);
  if (before_surviving > 0 || before_uncertain > 0) cleanup_known();
  size_t surviving, uncertain;
  fprintf(output, "{\"type\":\"result\",\"rootPid\":%d,\"rootStartSec\":%" PRIu64 ",\"rootStartUsec\":%" PRIu64 ",\"rootObserved\":%s,\"commandExitCode\":%d,\"signal\":%d,\"timedOut\":%s,\"sweeps\":%u,\"completeSweeps\":%u,\"terminalSweepComplete\":%s,\"maximumObservedNonAtomicSweepSumBytes\":%" PRIu64 ",\"survivingBeforeCleanup\":%zu,\"uncertainBeforeCleanup\":%zu,", child, root.start_sec, root.start_usec, root_observed ? "true" : "false", WIFEXITED(status) ? WEXITSTATUS(status) : -1, WIFSIGNALED(status) ? WTERMSIG(status) : interrupted, timed_out ? "true" : "false", sweeps, complete_sweeps, complete ? "true" : "false", maximum, before_surviving, before_uncertain);
  print_identity_status(output, &surviving, &uncertain);
  bool cleanup_proven = root_observed && surviving == 0 && uncertain == 0;
  bool success = cleanup_proven && before_surviving == 0 && before_uncertain == 0 && !terminating && WIFEXITED(status) && WEXITSTATUS(status) == 0 && complete_sweeps > 0;
  fprintf(output, ",\"cleanupProven\":%s,\"success\":%s}\n", cleanup_proven ? "true" : "false", success ? "true" : "false");
  fclose(output);
  free(table); free(slots); free(known); free(known_slots);
  return success ? 0 : 1;
}
