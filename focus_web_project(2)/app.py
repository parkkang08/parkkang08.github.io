import os
import math
import base64
from datetime import datetime

import cv2
import numpy as np
import mediapipe as mp

# DB는 선택(외부 MySQL 없으면 없어도 동작하도록)
try:
    import mysql.connector as mysql
except Exception:
    mysql = None

from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS

# =========================
# Flask 앱 (절대 경로 지정)
# =========================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(
    __name__,
    static_folder=os.path.join(BASE_DIR, "static"),
    static_url_path="/static",
    template_folder=os.path.join(BASE_DIR, "templates"),
)
CORS(app)

# 디버그 출력 (서버 기동 시 1회)
print("[DEBUG] CWD               :", os.getcwd())
print("[DEBUG] BASE_DIR          :", BASE_DIR)
print("[DEBUG] app.static_folder :", app.static_folder)
print("[DEBUG] app.static_url_path:", app.static_url_path)
print("[DEBUG] static exists?    :", os.path.exists(app.static_folder))
print(
    "[DEBUG] static list       :",
    os.listdir(app.static_folder) if os.path.exists(app.static_folder) else "NOPE",
)

# =========================
# DB 설정 (환경변수 우선)
# =========================
DB = dict(
    host=os.getenv("DB_HOST", "localhost"),
    user=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", "비밀번호_여기에"),
    database=os.getenv("DB_NAME", "focusdb"),
)

def get_db():
    if mysql is None:
        return None
    try:
        return mysql.connect(**DB)
    except Exception as e:
        print("[DB] connect error:", e)
        return None

# =========================
# Mediapipe FaceMesh
# =========================
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    static_image_mode=False,
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
)

# =========================
# 유틸 함수들
# =========================
def euclidean(p1, p2):
    return np.hypot(p1[0] - p2[0], p1[1] - p2[1])

def ear_from_landmarks(landmarks, image_w, image_h, eye_idx):
    """EAR = (‖p2-p6‖ + ‖p3-p5‖) / (2 * ‖p1-p4‖)"""
    pts = [(landmarks[i].x * image_w, landmarks[i].y * image_h) for i in eye_idx]
    p1, p2, p3, p4, p5, p6 = pts
    return (euclidean(p2, p6) + euclidean(p3, p5)) / (2.0 * euclidean(p1, p4) + 1e-6)

# 눈 랜드마크
LEFT_EYE  = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

# 머리자세용 포인트 (코 / 양 눈 바깥꼬리)
POSE_NOSE = 1
LEFT_EYE_OUTER = 33
RIGHT_EYE_OUTER = 263

def head_pose_score(landmarks, w, h):
    """
    간단 머리자세 점수 0~100
    - 눈 라인 기울기(roll) -> 정면일수록 100 (15도 기준)
    - 코-양눈 바깥꼬리 거리 비율(yaw proxy) -> 좌우 대칭일수록 100
    두 지표를 40:60 가중합
    """
    nose = (landmarks[POSE_NOSE].x * w, landmarks[POSE_NOSE].y * h)
    l_out = (landmarks[LEFT_EYE_OUTER].x * w, landmarks[LEFT_EYE_OUTER].y * h)
    r_out = (landmarks[RIGHT_EYE_OUTER].x * w, landmarks[RIGHT_EYE_OUTER].y * h)

    # 1) 눈 라인 기울기(roll)
    eye_dx = r_out[0] - l_out[0]
    eye_dy = r_out[1] - l_out[1]
    angle_deg = abs(math.degrees(math.atan2(eye_dy, eye_dx)))  # 0이 정면(수평)
    roll_penalty = min(1.0, angle_deg / 15.0)  # 0~15도 OK
    roll_score = 100.0 * (1.0 - roll_penalty)

    # 2) 좌우 비대칭(yaw proxy)
    dist_l = euclidean(nose, l_out)
    dist_r = euclidean(nose, r_out)
    if dist_l + dist_r < 1e-6:
        yaw_score = 0.0
    else:
        ratio = abs(dist_l - dist_r) / (dist_l + dist_r)  # 0(대칭) ~ 1
        yaw_penalty = min(1.0, max(0.0, (ratio - 0.05) / 0.25))  # 0.05 여유
        yaw_score = 100.0 * (1.0 - yaw_penalty)

    pose_score = yaw_score * 0.6 + roll_score * 0.4
    return max(0, min(100, pose_score))

# =========================
# 라우트
# =========================
@app.route("/")
def index():
    return render_template("index.html")

# EAR(눈) + 머리자세 기반 집중도 0~100
@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json()
    image_data = data["image"].split(",")[1]
    image_bytes = base64.b64decode(image_data)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        return jsonify({"score": 0})

    h, w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    res = face_mesh.process(img_rgb)
    if not res.multi_face_landmarks:
        # 얼굴을 못 찾으면 비집중
        return jsonify({"score": 0})

    lms = res.multi_face_landmarks[0].landmark

    # ---- 1) EAR 기반 점수 (눈 감김) ----
    ear_left  = ear_from_landmarks(lms, w, h, LEFT_EYE)
    ear_right = ear_from_landmarks(lms, w, h, RIGHT_EYE)
    ear = (ear_left + ear_right) / 2.0
    # 경험값: 눈 뜸 ~0.30, 감김 ~0.18 (환경에 따라 조절)
    OPEN_T, CLOSE_T = 0.30, 0.18
    norm = (ear - CLOSE_T) / (OPEN_T - CLOSE_T)  # 0~1
    norm = max(0.0, min(1.0, norm))
    ear_score = norm * 100.0  # 0~100

    # ---- 2) 머리 자세 점수 ----
    pose_score = head_pose_score(lms, w, h)  # 0~100

    # ---- 3) 최종 점수(가중 평균) ----
    # ▶ A 튜닝: 눈 60% + 머리 40%
    final = 0.6 * ear_score + 0.4 * pose_score
    score = int(round(max(0, min(100, final))))
    return jsonify({"score": score})

# 로그 저장
@app.route("/log", methods=["POST"])
def log_segment():
    payload = request.get_json()
    state = payload["state"]  # 'focus' or 'distract'
    start = datetime.fromisoformat(payload["start"].replace("Z", "+00:00"))
    end   = datetime.fromisoformat(payload["end"  ].replace("Z", "+00:00"))
    duration_sec = int((end - start).total_seconds())

    conn = get_db()
    if conn is None:
        # DB가 없거나 연결 실패해도 프론트는 계속 쓰게 OK 반환
        print("[DB] skip insert (no connection).", state, start, end, duration_sec)
        return jsonify({"ok": True, "db": "skipped"})

    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO focus_log (state, start_time, end_time, duration_sec)
            VALUES (%s, %s, %s, %s)
            """,
            (state, start, end, duration_sec),
        )
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        print("[DB] insert error:", e)
        return jsonify({"ok": False, "error": "db_insert_failed"}), 500

# ====== 디버그/점검 라우트 ======
@app.route("/_static_check")
def _static_check():
    d = app.static_folder
    return jsonify({
        "cwd": os.getcwd(),
        "static_folder": d,
        "exists_folder": os.path.exists(d),
        "files": os.listdir(d) if os.path.exists(d) else []
    })

@app.route("/test-start")
def test_start():
    # 업로드 파일이 .ogg라면 확장자를 .ogg로 맞추세요.
    filename = "start.ogg" if os.path.exists(os.path.join(app.static_folder, "start.ogg")) else "start.mp3"
    return send_from_directory(app.static_folder, filename)

# =========================
# 엔트리 포인트 (배포/로컬 겸용)
# =========================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
