


# COMMAND ----------

# MAGIC %pip install mediapipe==0.10.21
# MAGIC

# COMMAND ----------

# MAGIC %pip install numpy==1.23.5 scikit-learn==1.2.0
# MAGIC

# COMMAND ----------

# MAGIC %pip install protobuf==3.20.1
# MAGIC
# MAGIC

# COMMAND ----------

import os
import pickle

import mediapipe as mp
import cv2
import matplotlib.pyplot as plt


import pickle

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import numpy as np
from xgboost import XGBClassifier
from sklearn.preprocessing import LabelEncoder

# COMMAND ----------

data_dict = pickle.load(open('/Workspace/Users/am.sc.p2ari24002@am.students.amrita.edu/data.pickle', 'rb'))

expected_length = 42  # or whatever the majority length is
filtered_data = []
filtered_labels = []

for sample, label in zip(data_dict['data'], data_dict['labels']):
    if len(sample) == expected_length:
        filtered_data.append(sample)
        filtered_labels.append(label)

# Convert to NumPy array
data = np.array(filtered_data, dtype=np.float32)
labels = np.array(filtered_labels)

x_train, x_test, y_train, y_test = train_test_split(data, labels, test_size=0.2, shuffle=True, stratify=labels)

model = RandomForestClassifier()
# model = XGBClassifier()

model.fit(x_train, y_train)

y_predict = model.predict(x_test)

score = accuracy_score(y_predict, y_test)

print('{}% of samples were classified correctly !'.format(score * 100))

f = open('model.p', 'wb')
pickle.dump({'model': model}, f)
f.close()

# COMMAND ----------

# MAGIC %pip install playsound

# COMMAND ----------

import pickle

import cv2
import mediapipe as mp
import numpy as np

sentence = ""
prev_char = ""
count_same_char = 0
char_threshold = 10  # number of frames to wait before accepting a new char


model_dict = pickle.load(open('./model.p', 'rb'))
model = model_dict['model']

cap = cv2.VideoCapture(0)

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

hands = mp_hands.Hands(static_image_mode=True, min_detection_confidence=0.3)

while True:

    data_aux = []
    x_ = []
    y_ = []

    ret, frame = cap.read()

    H, W, _ = frame.shape

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    results = hands.process(frame_rgb)
    if results.multi_hand_landmarks:
        for hand_landmarks in results.multi_hand_landmarks:
            mp_drawing.draw_landmarks(
                frame,  # image to draw
                hand_landmarks,  # model output
                mp_hands.HAND_CONNECTIONS,  # hand connections
                mp_drawing_styles.get_default_hand_landmarks_style(),
                mp_drawing_styles.get_default_hand_connections_style())

        for hand_landmarks in results.multi_hand_landmarks:
            for i in range(len(hand_landmarks.landmark)):
                x = hand_landmarks.landmark[i].x
                y = hand_landmarks.landmark[i].y

                x_.append(x)
                y_.append(y)

            for i in range(len(hand_landmarks.landmark)):
                x = hand_landmarks.landmark[i].x
                y = hand_landmarks.landmark[i].y
                data_aux.append(x - min(x_))
                data_aux.append(y - min(y_))

        x1 = int(min(x_) * W) - 10
        y1 = int(min(y_) * H) - 10

        x2 = int(max(x_) * W) - 10
        y2 = int(max(y_) * H) - 10

        if len(data_aux) > 42:
            continue

        prediction = model.predict([np.asarray(data_aux)])
        print(prediction)

        predicted_character = prediction[0]
        # Check if predicted character is the same as the last one
        if predicted_character == prev_char:
            count_same_char += 1
        else:
            count_same_char = 0
            prev_char = predicted_character

        # If the same character has been predicted for enough frames
        if count_same_char == char_threshold:
            sentence += predicted_character
            print("Current Sentence:", sentence)
            count_same_char = 0  # reset counter after accepting
            prev_char = ""  # reset previous character to wait for next

        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 0), 4)
        cv2.putText(frame, predicted_character, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (0, 0, 0), 3,
                    cv2.LINE_AA)
        cv2.putText(frame, "Sentence: " + sentence, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 0, 0), 2)


    cv2.imshow('frame', frame)
    cv2.waitKey(1)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break


cap.release()
cv2.destroyAllWindows()