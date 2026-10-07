#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bash -n "$SCRIPT_DIR/vds/tuttoseriea-reconcile-images"
exec python3 -I -u - "$SCRIPT_DIR" <<'PY'
import ast
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

require = lambda condition, message: condition or (_ for _ in ()).throw(AssertionError(message))
require(sys.platform == "linux", "image-retention behavior checks require Linux and real flock")
scripts = Path(sys.argv[1])
source = (scripts / "vds/tuttoseriea-reconcile-images").read_text()
body = source.split("<<'PY'\n", 1)[1].rsplit("\nPY\n", 1)[0]
ast.parse(body)
web = "ghcr.io/mishakozarev/tuttoseriea/web"
ai = "ghcr.io/mishakozarev/tuttoseriea/ai-service"
pg = "pgvector/pgvector:0.8.6-pg18"
project = "https://github.com/MishaKozarev/tuttoseriea"
def sha(value):
    return "sha256:" + format(value, "064x")
def image_id(value):
    return sha(1000 + value)
def release(number, web_digest, ai_digest):
    return format(number, "040x") + " " + sha(web_digest) + " " + sha(ai_digest)
def meta(number, repository, image_digest, tags=None):
    return {"id": image_id(number), "digests": [repository + "@" + sha(image_digest)],
            "tags": tags or [], "source": project if repository in (web, ai) else None}

FAKE_DOCKER = r'''#!__PYTHON__
import json, os, signal, subprocess, sys
from pathlib import Path
root = Path(__ROOT__)
path = root / "data.json"
data = json.loads(path.read_text())
args = sys.argv[1:]
assert args[:2] == ["--host", "unix:///var/run/docker.sock"]
args = args[2:]
with (root / "trace.jsonl").open("a") as trace:
    trace.write(json.dumps(args) + "\n")
data["calls"] = data.get("calls", 0) + 1
def save():
    path.write_text(json.dumps(data))
def output(value):
    save()
    print(json.dumps(value))
if data.get("unavailable"):
    save(); sys.exit(42)
if args == ["image", "ls", "--all", "--no-trunc", "--quiet"]:
    data["lists"] = data.get("lists", 0) + 1
    if data.get("disappear") and data["lists"] == 2:
        data["images"].pop(data["disappear"], None)
    if data.get("new_alias") and data["lists"] == 2:
        data["images"][data["new_alias"]]["tags"] = ["example/foreign:alias"]
    save()
    print("\n".join(sorted(data["images"])))
elif args[:3] == ["image", "inspect", "--format"]:
    reference = args[-1]
    matches = [item for item in data["images"].values()
               if reference == item["id"] or reference in item["digests"] or reference in item["tags"]]
    if len(matches) != 1:
        save(); sys.exit(44)
    output(matches[0])
elif args == ["ps", "--all", "--no-trunc", "--quiet"]:
    data["container_lists"] = data.get("container_lists", 0) + 1
    if data.get("become_running") and data["container_lists"] == 2:
        identifier = "f" * 64
        data["containers"][identifier] = {"id":identifier, "image":data["become_running"], "running":True}
    if data.get("reader_drift") and data["container_lists"] == 1:
        with (root / "production-reader").open("a") as reader:
            reader.write("# unreviewed drift\n")
    save()
    print("\n".join(sorted(data["containers"])))
elif args[:2] == ["inspect", "--format"]:
    output(data["containers"][args[-1]])
elif args[:3] == ["image", "rm", "--no-prune"]:
    assert len(args) == 4 and args[-1] in data["images"]
    if data.get("kill_helper") == args[-1]:
        parent = os.getppid()
        children = Path(f"/proc/{parent}/task/{parent}/children").read_text().split()
        helpers = [int(pid) for pid in children if Path(f"/proc/{pid}/comm").read_text().strip() == "bash"]
        assert len(helpers) == 1, "cannot identify private lock helper"
        os.kill(helpers[0], signal.SIGKILL)
        data["helper_killed"] = True
    for name in ("staging", "production", "reconcile"):
        result = subprocess.run(["/usr/bin/flock", "-n", str(root / (name + ".lock")), "true"])
        assert result.returncode != 0, "image deletion without all coordination locks"
    identifier = args[-1]
    if data.get("delete_failure") == identifier:
        save(); sys.exit(17)
    if data.get("delete_error_after_removal") == identifier:
        data["images"].pop(identifier)
        save(); sys.exit(18)
    data["images"].pop(identifier)
    data.setdefault("removed", []).append(identifier)
    save()
else:
    raise AssertionError("forbidden/unexpected Docker command: " + repr(args))
'''

with tempfile.TemporaryDirectory(prefix="tuttoseriea-image-retention.") as directory:
    root = Path(directory)
    stage = root / "staging"
    prod = root / "production"
    stage.mkdir(mode=0o700)
    prod.mkdir(mode=0o700)
    reader = root / "production-reader"
    docker = root / "docker"
    executable = root / "reconciler"
    reader_source = scripts / "vds/tuttoseriea-read-release-state-production"
    require(hashlib.sha256(reader_source.read_bytes()).hexdigest() ==
            '113ff4f062d66586af3017cb43e41bee280ad9bb272aad32a9c1beaa155cb30b',
            "canonical production reader changed; lock lease requires review")
    reader_template = reader_source.read_text()
    reader_template = reader_template.replace("/srv/tuttoseriea/production/state", str(prod))
    reader_template = reader_template.replace("/run/lock/tuttoseriea-production-deploy.lock", str(root / "production.lock"))
    docker.write_text(FAKE_DOCKER.replace("__PYTHON__", sys.executable).replace("__ROOT__", repr(str(root))))
    docker.chmod(0o700)

    def install_reader(value=reader_template):
        reader.write_text(value)
        reader.chmod(0o700)
        fixture = source.replace("/usr/bin/python3", sys.executable)
        for before, after in (
            ('OWNER_UID = 0', 'OWNER_UID = ' + str(os.geteuid())),
            ('OWNER_GID = 0', 'OWNER_GID = ' + str(os.getegid())),
            ('SECURE_ROOT = Path("/")', 'SECURE_ROOT = Path(' + repr(str(root)) + ')'),
            ('/srv/tuttoseriea/staging/state', str(stage)),
            ('/run/lock/tuttoseriea-staging-deploy.lock', str(root / "staging.lock")),
            ('/run/lock/tuttoseriea-production-deploy.lock', str(root / "production.lock")),
            ('/run/lock/tuttoseriea-image-reconcile.lock', str(root / "reconcile.lock")),
            ('/usr/local/sbin/tuttoseriea-read-release-state-production', str(reader)),
            ('/usr/bin/docker', str(docker)),
            ('113ff4f062d66586af3017cb43e41bee280ad9bb272aad32a9c1beaa155cb30b',
             hashlib.sha256(value.encode()).hexdigest()),
        ):
            fixture = fixture.replace(before, after)
        require('/srv/tuttoseriea/' not in fixture and '/run/lock/' not in fixture
                and '/usr/bin/docker' not in fixture, "fixture path isolation failed")
        executable.write_text(fixture)
        executable.chmod(0o700)

    def baseline():
        for folder in (stage, prod):
            for path in folder.iterdir():
                path.unlink()
        values = {stage / "current-release": release(1, 11, 12), stage / "verified-release": release(2, 21, 22),
                  prod / "current-release": release(3, 31, 32), prod / "verified-release": release(3, 31, 32),
                  prod / "previous-release": release(4, 41, 42)}
        for path, value in values.items():
            path.write_text(value + "\n")
            path.chmod(0o600)
        images = {item["id"]:item for item in (
            meta(1, web, 11), meta(2, ai, 12), meta(3, web, 21), meta(4, ai, 22),
            meta(5, web, 31), meta(6, ai, 32), meta(7, web, 41), meta(8, ai, 42),
            meta(9, "pgvector/pgvector", 55, [pg]), meta(10, web, 51),
            meta(11, web, 61), meta(12, ai, 62), meta(13, "example/third-party", 71))}
        identifier = "a" * 64
        data = {"images": images, "containers": {identifier:{"id":identifier,"image":image_id(10),"running":True}}}
        (root / "data.json").write_text(json.dumps(data))
        (root / "trace.jsonl").write_text("")
        install_reader()
        return data

    def set_data(data):
        (root / "data.json").write_text(json.dumps(data))
    def state_bytes():
        return {str(path):path.read_bytes() for folder in (stage, prod) for path in folder.iterdir()}
    def run(mode="--dry-run", expected=0):
        before = state_bytes()
        argv = ["/bin/bash", str(executable)] + ([mode] if mode else [])
        result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        require(result.returncode == expected, "wrong exit: " + result.stderr.decode(errors="replace"))
        output = json.loads(result.stdout)
        require(before == state_bytes(), "reconciler wrote release state")
        require("Config.Env" not in result.stdout.decode(), "unexpected env output")
        trace = [json.loads(line) for line in (root / "trace.jsonl").read_text().splitlines()]
        for command in trace:
            if command[:2] == ["image", "rm"]:
                require(command[:3] == ["image", "rm", "--no-prune"] and len(command) == 4,
                        "delete must be one exact ID with parent pruning disabled")
            else:
                require(command[:2] in (["image", "ls"], ["image", "inspect"]) or
                        command[0] in ("ps", "inspect"), "unexpected Docker operation")
            require(not any(word in command for word in ("--force", "prune", "pull", "run", "exec", "restart")),
                    "forbidden Docker operation")
        return output, json.loads((root / "data.json").read_text())

    data = baseline()
    output, after = run(None)
    require(output["mode"] == "--dry-run" and not after.get("removed"), "default mode mutated images")
    require({item["image_id"] for item in output["candidates"]} == {image_id(11),image_id(12)}, "wrong obsolete candidates")
    require(len(output["staging_protected"]) == 4 and len(output["production_protected"]) == 6,
            "incomplete release protection")
    require(output["pgvector_protected"][0]["image_id"] == image_id(9), "pgvector unprotected")
    require(output["running_protected"][0]["image"] == image_id(10), "outside-state running image unprotected")
    print("default_dry_run_current_neq_verified_prod_previous_running_pgvector_unrelated=passed")

    baseline()
    output, after = run("--apply")
    require(set(output["deleted"]) == {image_id(11), image_id(12)}, "apply deleted non-exact candidates")
    output, after = run("--apply")
    require(not output["deleted"] and not output["candidates"], "apply is not idempotent")
    print("apply_exact_web_ai_ids_all_three_locks_held_and_idempotency=passed")

    baseline()
    (stage / "verified-release").write_bytes((stage / "current-release").read_bytes())
    output, after = run()
    require({item["image_id"] for item in output["candidates"]} == {image_id(3),image_id(4),image_id(11),image_id(12)},
            "equal current/verified retention differs")
    print("current_eq_verified=passed")

    baseline()
    (prod / "previous-release").unlink()
    output, after = run()
    require(len(output["production_protected"]) == 4, "explicit previous absence invalid")
    print("production_previous_absent=passed")

    for path in (stage / "current-release", stage / "verified-release"):
        baseline(); path.write_text("malformed\n")
        output, after = run("--apply", 2)
        require(not after.get("removed"), "malformed staging allowed delete")
        baseline(); path.unlink()
        output, after = run("--apply", 1)
        require(not after.get("removed"), "missing staging allowed delete")
    print("malformed_missing_staging_no_delete=passed")

    baseline(); (prod / "verified-release").write_text("malformed\n")
    output, after = run("--apply", 2)
    require(not after.get("removed"), "reader failure allowed delete")
    baseline(); reader.unlink()
    output, after = run("--apply", 1)
    require(not after.get("removed"), "missing reader allowed delete")
    baseline(); install_reader("#!/bin/bash\nexit 1\n")
    output, after = run("--apply", 2)
    require(not after.get("removed"), "failed reader allowed delete")
    baseline(); install_reader('#!/bin/bash\nprintf "verified absent\\ncurrent absent\\nprevious absent\\n"\n')
    output, after = run("--apply", 2)
    require(not after.get("removed"), "malformed reader output allowed delete")
    print("production_missing_failure_malformed_order_no_delete=passed")

    baseline()
    with reader.open("a") as handle:
        handle.write("# unreviewed drift\n")
    output, after = run("--apply", 2)
    require(not after.get("removed"), "unreviewed reader hash allowed delete")
    baseline(); install_reader('#!/bin/bash\nprintf "current absent\\r\\nverified absent\\nprevious absent\\n"\n')
    output, after = run("--apply", 2)
    require(not after.get("removed"), "noncanonical reader framing allowed delete")
    data = baseline(); data["reader_drift"] = True; set_data(data)
    output, after = run("--apply", 2)
    require(not after.get("removed") and not output["protection_complete"], "late reader drift allowed delete")
    print("reader_exact_source_strict_framing_and_late_drift_no_delete=passed")

    data = baseline(); data["unavailable"] = True; set_data(data)
    output, after = run("--apply", 1)
    require(not after.get("removed"), "Docker unavailable allowed delete")
    print("Docker_unavailable_no_delete=passed")

    for identifier in (image_id(1), image_id(9)):
        data = baseline(); data["images"].pop(identifier); set_data(data)
        output, after = run("--apply", 1)
        require(not after.get("removed") and not output["protection_complete"], "incomplete protected mapping allowed delete")
    print("missing_release_or_pgvector_mapping_no_delete=passed")

    data = baseline(); data["images"][image_id(11)]["digests"] = []; set_data(data)
    output, after = run("--apply", 2)
    require(output["ambiguous"] and not after.get("removed"), "missing RepoDigests allowed delete")
    data = baseline(); data["images"][image_id(11)]["tags"] = ["example/third-party:alias"]; set_data(data)
    output, after = run("--apply", 2)
    require(not after.get("removed"), "foreign shared alias allowed delete")
    data = baseline(); data["images"][image_id(11)]["digests"] = data["images"][image_id(1)]["digests"][:]; set_data(data)
    output, after = run("--apply", 2)
    require(not after.get("removed"), "duplicate RepoDigest binding allowed delete")
    print("missing_RepoDigests_foreign_alias_duplicate_binding_no_delete=passed")

    data = baseline()
    data["images"][image_id(1)]["digests"].append(ai + "@" + sha(61))
    data["images"].pop(image_id(11)); set_data(data)
    output, after = run("--apply")
    require(output["deleted"] == [image_id(12)] and image_id(1) in after["images"], "shared protected ID deleted")
    print("protected_ID_all_repository_aliases_retained=passed")

    data = baseline(); data["become_running"] = image_id(11); set_data(data)
    output, after = run("--apply")
    require(output["deleted"] == [image_id(12)] and image_id(11) in after["images"]
            and output["skipped"][0]["reason"] == "became_protected", "newly protected candidate deleted")
    data = baseline(); data["disappear"] = image_id(11); set_data(data)
    output, after = run("--apply")
    require(output["deleted"] == [image_id(12)] and output["skipped"][0]["reason"] == "already_absent",
            "disappearing candidate was not an idempotent skip")
    print("candidate_becomes_running_protected_or_disappears=passed")

    data = baseline()
    data["containers"]["b" * 64] = {"id":"b" * 64,"image":image_id(11),"running":False}
    set_data(data)
    output, after = run("--apply")
    require(output["deleted"] == [image_id(12)] and output["container_retained"], "stopped container reference deleted")
    data = baseline(); data["new_alias"] = image_id(11); set_data(data)
    output, after = run("--apply", 2)
    require(not after.get("removed"), "late alias ambiguity allowed delete")
    baseline()
    changing_reader = reader_template.replace('printf \'%s\\n\' "${records[@]}"',
        'snapshot_count="${snapshot_count:-0}"\n'
        'snapshot_count=$((snapshot_count + 1))\n'
        'if [[ "$snapshot_count" -ge 2 ]]; then\n'
        '    records[2]="previous ' + release(5, 61, 62) + '"\n'
        'fi\n'
        'printf \'%s\\n\' "${records[@]}"')
    require(changing_reader != reader_template, "release transition fixture was not injected")
    install_reader(changing_reader)
    output, after = run("--apply")
    require(not output["deleted"] and len(output["skipped"]) == 2
            and all(item["reason"] == "became_protected" for item in output["skipped"]),
            "newly protected release candidate deleted")
    print("stopped_references_late_alias_ambiguity_and_release_revalidation=passed")

    data = baseline(); data["delete_failure"] = image_id(12); set_data(data)
    output, after = run("--apply", 1)
    require(output["deleted"] == [image_id(11)] and output["status"] == "partial"
            and image_id(12) in after["images"], "partial failure result incorrect")
    require(output["delete_attempts"][-1] == {"image_id":image_id(12),"outcome":"failed_image_still_present"},
            "failed deletion outcome not reported")
    data = baseline(); data["delete_error_after_removal"] = image_id(11); set_data(data)
    output, after = run("--apply", 1)
    require(not output["deleted"] and image_id(12) in after["images"]
            and output["delete_attempts"] == [{"image_id":image_id(11),"outcome":"absent_after_cli_error"}],
            "CLI deletion error continued or falsely reported success")
    print("delete_failure_stops_with_exact_partial_result=passed")

    data = baseline(); data["kill_helper"] = image_id(11); set_data(data)
    output, after = run("--apply", 2)
    require(after.get("helper_killed") and output["deleted"] == [image_id(11)]
            and image_id(12) in after["images"] and output["status"] == "partial",
            "helper death lost coordination or allowed remaining deletes")
    print("production_lock_FD_handoff_survives_helper_death_stops_remaining_deletes=passed")

    import fcntl
    for name in ("reconcile", "staging", "production"):
        baseline()
        fd = os.open(root / (name + ".lock"), os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            output, after = run("--apply", 2 if name == "production" else 75)
            require(not after.get("removed"), "busy lock allowed delete")
        finally:
            os.close(fd)
    print("all_coordination_lock_contention_no_delete=passed")

    canary = root / "never-truncate"
    canary.write_text("fixture canary\n")
    for name in ("reconcile", "staging", "production"):
        baseline()
        path = root / (name + ".lock")
        path.unlink(missing_ok=True)
        path.symlink_to(canary)
        try:
            output, after = run("--apply", 2)
            require(not after.get("removed") and canary.read_text() == "fixture canary\n",
                    "unsafe lock followed symlink or allowed delete")
        finally:
            path.unlink()
    baseline(); (stage / "current-release").chmod(0o644)
    output, after = run("--apply", 2)
    require(not after.get("removed"), "unsafe state permissions allowed delete")
    baseline(); reader.chmod(0o755)
    output, after = run("--apply", 2)
    require(not after.get("removed"), "unsafe reader permissions allowed delete")
    print("unsafe_lock_symlinks_state_reader_modes_no_delete_no_truncation=passed")

    baseline()
    output, after = run("--unexpected", 2)
    require(not after.get("removed"), "unapproved argument allowed delete")
    print("invalid_CLI_no_delete=passed")

    # The real reader is unchanged; both code and all writer contracts remain fixed.
    require('/srv/tuttoseriea/production/state' not in source, "reconciler directly reads production state")
    require('. /usr/local/sbin/tuttoseriea-read-release-state-production' in source, "approved reader bypassed")
    for word in ("--force", "image prune", "system prune", "volume prune"):
        require(word not in source, "unsafe deletion operation in source")
    service = (scripts / "vds/tuttoseriea-reconcile-images.service").read_text()
    timer = (scripts / "vds/tuttoseriea-reconcile-images.timer").read_text()
    require('Type=oneshot' in service and 'User=root' in service and 'Requisite=docker.service' in service,
            "unexpected service contract")
    require('ExecStart=/usr/local/sbin/tuttoseriea-reconcile-images --apply' in service
            and 'Requires=' not in service and 'WantedBy=' not in service, "service starts Docker or auto-enables")
    require('OnCalendar=*-*-* 03:30:00 UTC' in timer and 'Persistent=true' in timer,
            "unexpected timer contract")
    print("fixed_interfaces_no_broad_operations_systemd_source_contract=passed")

    analyzer = shutil.which("systemd-analyze")
    if analyzer is None:
        print("native_systemd_unit_verify=not_run (systemd-analyze unavailable)")
    else:
        units = root / "units"
        units.mkdir()
        service_path = units / "tuttoseriea-reconcile-images.service"
        timer_path = units / "tuttoseriea-reconcile-images.timer"
        service_path.write_text(service.replace('/usr/local/sbin/tuttoseriea-reconcile-images --apply',
                                               sys.executable + ' -c pass'))
        timer_path.write_text(timer)
        (units / "docker.service").write_text('[Service]\nType=oneshot\nExecStart=' + sys.executable + ' -c pass\n')
        environment = dict(os.environ, SYSTEMD_UNIT_PATH=str(units) + ":")
        result = subprocess.run([analyzer, "--man=no", "verify", str(service_path), str(timer_path)],
                                env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        require(result.returncode == 0, "native unit verification failed: " + result.stderr.decode(errors="replace"))
        print("native_systemd_unit_verify=passed (private executable/dependency fixtures; no activation)")
print("image_retention_check=passed")
PY
