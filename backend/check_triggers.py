import json
import psycopg2
import os

try:
    conn = psycopg2.connect("postgresql://postgres:postgres@localhost:5432/hubdubai")
    cursor = conn.cursor()
    cursor.execute("SELECT trigger_name, event_object_table, action_statement FROM information_schema.triggers")
    triggers = cursor.fetchall()
    print("TRIGGERS:", triggers)
    conn.close()
except Exception as e:
    print("Error:", e)
