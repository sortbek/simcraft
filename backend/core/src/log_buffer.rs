use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

const MAX_LINES_PER_JOB: usize = 500;

struct JobLog {
    lines: VecDeque<String>,
    next_index: usize,
    first_index: usize,
}

impl JobLog {
    fn new() -> Self {
        Self {
            lines: VecDeque::new(),
            next_index: 0,
            first_index: 0,
        }
    }
}

pub struct LogBuffer {
    inner: Mutex<HashMap<String, JobLog>>,
}

impl Default for LogBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Append a log line for a job. Ring buffer keeps the last MAX_LINES_PER_JOB lines.
    pub fn push_line(&self, job_id: &str, line: String) {
        let mut map = self.inner.lock().unwrap();
        let log = map.entry(job_id.to_string()).or_insert_with(JobLog::new);
        log.lines.push_back(line);
        log.next_index += 1;
        if log.lines.len() > MAX_LINES_PER_JOB {
            log.lines.pop_front();
            log.first_index += 1;
        }
    }

    /// Get log lines with index > `after`. Returns (lines, next_index).
    /// The caller should pass `next` back as `after` on the next call.
    pub fn get_lines_after(&self, job_id: &str, after: usize) -> (Vec<String>, usize) {
        let map = self.inner.lock().unwrap();
        let log = match map.get(job_id) {
            Some(l) => l,
            None => return (Vec::new(), 0),
        };

        if after >= log.next_index {
            return (Vec::new(), log.next_index);
        }

        // Calculate how many lines to skip from the front of the deque.
        // `after` is the cursor (last index the client has seen).
        // Lines in the deque cover indices [first_index, next_index).
        let start = after.saturating_sub(log.first_index);

        let lines: Vec<String> = log.lines.iter().skip(start).cloned().collect();
        (lines, log.next_index)
    }

    /// Remove all logs for a job (call on completion/failure/cancel).
    pub fn remove(&self, job_id: &str) {
        self.inner.lock().unwrap().remove(job_id);
    }
}
