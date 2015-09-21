imapseagull-storage-mongo
=========================

Mongo storage implementation for https://github.com/maxvyaznikov/imapseagull

## Database structure

Example of one real message record:
```
{  
   "_id":ObjectId("5453c700ad8fd6de1471bfd2"),
   "uid":2,
   "user":ObjectId("53999d8944ea281c39c4c61d"),
   "subject":null,
   "date":   ISODate("2014-10-31T17:29:25   Z"),
   "internaldate":   ISODate("2014-10-31T17:29:36.298   Z"),
   "headers":{  
      "received":[  
         "by mail-yk0-f179.google.com with SMTP id 131so3471659ykp.24 for <max@myclerk.ru>; Fri, 31 Oct 2014 10:29:33 -0700 (PDT)",
         <...>
      ],
      "x-received":[  
         "by 10.170.214.6 with SMTP id g6mr6753058ykf.34.1414776573490; Fri, 31 Oct 2014 10:29:33 -0700 (PDT)",
         <...>
      ],
      "x-forwarded-to":[  
         "max@myclerk.ru"
      ],
      "x-forwarded-for":"max@myclerk.ru",
      "delivered-to":[  
         <...>
      ],
      <...>
   },
   "text":"<...>",
   "html":null,
   "folder":"\\Inbox",
   "to":[  
      {  
         "address":"<...>",
         "name":"<...>"
      }
   ],
   "attached_files":[  
      {  
         "path":"7c63baf11ecd5891a9a5d04c585d1f49-606889",
         "name":"<...>",
         "ext":"docx",
         "cid":"41b9ab23498a9dd752d97e50e5a72baf@mailparser",
         "length":58474,
         "contentType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      }
   ],
   "flags":[  
      "\\Seen"
   ]
}
```

## Post-parse handlers

Make HTML safe
https://gist.github.com/maxvyaznikov/e282764465f1fead480a

